import type { NumberPar, ParMode } from "../ops/catalog";

export interface FloatParam {
  kind: "float";
  name: string;
  min: number;
  max: number;
  value: number;
  label: string;
  /** Like an op's number par: "expression" cooks `expr` on the CPU every frame. */
  mode?: ParMode;
  expr?: string;
}

export interface ColorParam {
  kind: "color";
  name: string;
  value: [number, number, number];
  label: string;
}

export type ShaderParam = FloatParam | ColorParam;

/** What a parameter row writes: a number, a color, or an op-style { mode, value, expr } patch. */
export type ShaderParamPatch = number | [number, number, number] | { mode?: ParMode; value?: number; expr?: string };

/** A float uniform seen as an op number par, so it shares the par row and resolvePars. */
export function shaderNumberPar(param: FloatParam): NumberPar {
  return {
    kind: "number",
    name: param.name,
    mode: param.mode ?? "constant",
    value: param.value,
    expr: param.expr ?? "",
    min: param.min,
    max: param.max,
  };
}

export function patchShaderParam(param: ShaderParam, patch: ShaderParamPatch): ShaderParam {
  if (param.kind === "color") return Array.isArray(patch) ? { ...param, value: patch } : param;
  if (Array.isArray(patch)) return param;
  if (typeof patch === "number") return Number.isFinite(patch) ? { ...param, mode: "constant", value: patch } : param;
  const next = { ...param };
  if (patch.mode) next.mode = patch.mode;
  if (typeof patch.value === "number" && Number.isFinite(patch.value)) next.value = patch.value;
  if (typeof patch.expr === "string") next.expr = patch.expr;
  return next;
}

/**
 * Room encoding. A plain constant float stays a bare number and a color an [r, g, b], as before.
 * A float with an expression is the op par string "n:<mode>:<value>:<expr>".
 */
export function encodeShaderParam(param: ShaderParam): number | [number, number, number] | string {
  if (param.kind === "color") return param.value;
  if (!param.expr && param.mode !== "expression") return param.value;
  return `n:${param.mode ?? "constant"}:${param.value}:${encodeURIComponent(param.expr ?? "")}`;
}

export function decodeShaderParam(param: ShaderParam, raw: unknown): ShaderParam {
  if (param.kind === "color") return Array.isArray(raw) && raw.length === 3 ? { ...param, value: [Number(raw[0]), Number(raw[1]), Number(raw[2])] } : param;
  if (typeof raw === "number") return { ...param, value: raw, mode: "constant", expr: "" };
  if (typeof raw !== "string" || !raw.startsWith("n:")) return param;
  const [mode, value, ...expr] = raw.slice(2).split(":");
  const number = Number(value);
  return {
    ...param,
    mode: mode === "expression" ? "expression" : "constant",
    value: Number.isFinite(number) ? number : param.value,
    expr: decodeURIComponent(expr.join(":")),
  };
}

export interface ParsedShader {
  channels: number[];
  feedback: boolean;
  params: ShaderParam[];
}

const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform float iFrameRate;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iSampleRate;
uniform float iChannelTime[4];
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec3 iChannelResolution[4];
uniform vec4 iCursors[8];
uniform int iCursorCount;
`;

const FOOTER = `
out vec4 pc_fragColor;
void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  pc_fragColor = color;
}
`;

export const HEADER_LINES = HEADER.split("\n").length - 1;

export function wrapShader(user: string): { source: string; userLines: number } {
  const body = user.endsWith("\n") ? user : `${user}\n`;
  return {
    source: `${HEADER}${body}${FOOTER}`,
    userLines: body.split("\n").length - 1,
  };
}

export function parseShader(source: string): ParsedShader {
  const feedback = /^[ \t]*\/\/[ \t]*@feedback\b/m.test(source);
  const stripped = stripComments(source);
  const channels = new Set<number>();
  for (const match of stripped.matchAll(/\biChannel([0-3])\b/g)) {
    channels.add(Number(match[1]));
  }
  if (feedback) channels.delete(3);

  const params: ShaderParam[] = [];
  const seen = new Set<string>();
  for (const line of source.split("\n")) {
    const range = line.match(
      /^\s*uniform\s+float\s+(\w+)\s*;\s*\/\/\s*@range\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)(?:\s+default\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?))?(?:\s+label\s+"([^"]*)")?\s*$/,
    );
    if (range) {
      const name = range[1] ?? "";
      if (seen.has(name)) continue;
      seen.add(name);
      const min = Number(range[2]);
      const max = Number(range[3]);
      const value = range[4] !== undefined ? Number(range[4]) : min;
      params.push({
        kind: "float",
        name,
        min,
        max,
        value,
        label: range[5] || name,
      });
      continue;
    }
    const color = line.match(/^\s*uniform\s+vec3\s+(\w+)\s*;\s*\/\/\s*@color\s+#([0-9a-fA-F]{6})\s*$/);
    if (color) {
      const name = color[1] ?? "";
      if (seen.has(name)) continue;
      seen.add(name);
      const hex = color[2] ?? "ffffff";
      params.push({
        kind: "color",
        name,
        label: name,
        value: [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255],
      });
    }
  }

  return {
    channels: [...channels].sort(),
    feedback,
    params,
  };
}

export function compilerErrors(message: string, userLines: number): string {
  const found = message.match(/ERROR:\s*\d+:\d+:[^\n]*/g) ?? [];
  const unique = [...new Set(found)];
  if (unique.length === 0) {
    const tail = message
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-3);
    return tail.join("\n") || "shader failed to compile";
  }
  return remapErrors(unique.join("\n"), userLines);
}

export function remapErrors(log: string, userLines: number): string {
  return log
    .split("\n")
    .map((line) =>
      line.replace(/ERROR:\s*\d+:(\d+):/g, (_all, raw: string) => {
        const glLine = Number(raw);
        const userLine = glLine - HEADER_LINES;
        if (userLine >= 1 && userLine <= userLines) return `line ${userLine}:`;
        if (userLine < 1) return `wrapper:${glLine}:`;
        return `footer:${userLine - userLines}:`;
      }),
    )
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function errorMarks(log: string, userLines: number): { line: number; message: string }[] {
  const marks: { line: number; message: string }[] = [];
  for (const line of remapErrors(log, userLines).split("\n")) {
    const match = line.match(/^line (\d+):\s*(.*)$/);
    if (!match) continue;
    marks.push({ line: Number(match[1]), message: match[2] || line });
  }
  return marks;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
