import type { Family } from "../family";

export type ParMode = "constant" | "expression";

export interface NumberPar {
  kind: "number";
  name: string;
  mode: ParMode;
  value: number;
  expr: string;
  min: number;
  max: number;
  step?: number;
}

export interface MenuPar {
  kind: "menu";
  name: string;
  value: string;
  options: string[];
}

export interface TextPar {
  kind: "text";
  name: string;
  value: string;
  /** The value names another op of this family (and type) by its label; a rename follows it. */
  ref?: { family: Family; type?: string };
}

export type Par = NumberPar | MenuPar | TextPar;

export interface OpData {
  [key: string]: unknown;
  kind: "op";
  family: Family;
  type: string;
  label: string;
  bypass: boolean;
  status: "idle" | "live" | "error";
  error: string | null;
  pars: Par[];
}

export interface OpSpec {
  family: Family;
  type: string;
  inputs: number;
  pars: Par[];
}

export interface InletSource {
  kind: string;
  family: Family;
  type?: string;
  channels?: number[];
}

const num = (name: string, value: number, min: number, max: number, step?: number): NumberPar => ({
  kind: "number",
  name,
  mode: "constant",
  value,
  expr: "",
  min,
  max,
  step,
});

const menu = (name: string, value: string, options: string[]): MenuPar => ({ kind: "menu", name, value, options });
const text = (name: string, value: string): TextPar => ({ kind: "text", name, value });
const ref = (name: string, family: Family, type?: string): TextPar => ({ kind: "text", name, value: "", ref: { family, type } });

export const OPS: OpSpec[] = [
  {
    family: "CHOP",
    type: "lfo",
    inputs: 0,
    pars: [num("frequency", 1, 0, 8), num("amp", 1, 0, 4), num("offset", 0, -2, 2)],
  },
  {
    family: "CHOP",
    type: "pattern",
    inputs: 0,
    pars: [num("phase", 0, -8, 8), num("amp", 1, 0, 4)],
  },
  {
    family: "CHOP",
    type: "audioband",
    inputs: 0,
    pars: [num("lo", 0, 0, 1), num("hi", 0.08, 0, 1), num("gain", 1, 0, 8)],
  },
  {
    family: "CHOP",
    type: "math",
    inputs: 2,
    pars: [
      menu("chopop", "remap", ["remap", "add"]),
      num("from1", -1, -8, 8),
      num("from2", 1, -8, 8),
      num("to1", 0, -8, 8),
      num("to2", 1, -8, 8),
    ],
  },
  { family: "CHOP", type: "null", inputs: 1, pars: [] },
  {
    family: "POP",
    type: "pointgen",
    inputs: 0,
    pars: [menu("shape", "circle", ["circle", "sphere"]), num("n", 256, 1, 4096, 1), num("s", 0.2, 0, 4)],
  },
  {
    family: "POP",
    type: "noise",
    inputs: 1,
    pars: [
      num("seed", 0, 0, 64),
      num("period", 0.25, 0.01, 8),
      num("harmon", 1, 0, 2, 1),
      num("spread", 2, 1, 4),
      num("gain", 0.5, 0, 2),
      num("amp", 1, 0, 4),
      num("t4d", 0, -8, 8),
    ],
  },
  {
    family: "POP",
    type: "mathmix",
    inputs: 1,
    pars: [
      menu("oper", "aaddbmultc", ["aaddbmultc", "asubb", "mix"]),
      text("scopeA", "P"),
      text("scopeB", "Noise"),
      text("scopeC", "1"),
      text("result", "P"),
    ],
  },
  {
    family: "POP",
    type: "mathcombine",
    inputs: 1,
    pars: [
      menu("oper", "mix", ["mix", "aaddbmultc", "asubb"]),
      text("scopeA", "P"),
      text("scopeB", "Pnoise"),
      text("scopeC", "weight"),
      text("result", "P"),
      num("weight", 1, 0, 1),
    ],
  },
  {
    family: "POP",
    type: "transform",
    inputs: 1,
    pars: [
      num("tx", 0, -8, 8),
      num("ty", 0, -8, 8),
      num("tz", 0, -8, 8),
      num("rx", 0, -360, 360),
      num("ry", 0, -360, 360),
      num("rz", 0, -360, 360),
      num("sx", 1, 0, 4),
      num("sy", 1, 0, 4),
      num("sz", 1, 0, 4),
    ],
  },
  { family: "POP", type: "merge", inputs: 2, pars: [] },
  { family: "POP", type: "null", inputs: 1, pars: [] },
  {
    family: "MAT",
    type: "point",
    inputs: 0,
    pars: [
      num("scale", 6, 0.1, 64),
      num("focus", 4, 0, 32),
      num("alpha", 0.85, 0, 1),
      num("colorr", 1, 0, 4),
      num("colorg", 1, 0, 4),
      num("colorb", 1, 0, 4),
    ],
  },
  {
    family: "COMP",
    type: "cam",
    inputs: 0,
    pars: [
      num("tx", 0, -20, 20),
      num("ty", 0, -20, 20),
      num("tz", 5, -40, 40),
      num("fov", 45, 10, 120),
      num("lookx", 0, -20, 20),
      num("looky", 0, -20, 20),
      num("lookz", 0, -40, 40),
    ],
  },
  {
    family: "COMP",
    type: "geo",
    inputs: 0,
    pars: [ref("pop", "POP"), ref("mat", "MAT"), ref("cam", "COMP", "cam")],
  },
  { family: "TOP", type: "render", inputs: 0, pars: [ref("geo", "COMP", "geo")] },
  {
    family: "TOP",
    type: "bloom",
    inputs: 1,
    pars: [num("threshold", 0.01, 0, 1), num("fill", 0.72, 0, 1), num("intensity", 1.24, 0, 4), num("pregamma", 1.5, 0.2, 4)],
  },
];

const BY_KEY = new Map(OPS.map((spec) => [`${spec.family}:${spec.type}`, spec]));

export function opSpec(family: Family, type: string): OpSpec | undefined {
  return BY_KEY.get(`${family}:${type}`);
}

export function clonePar(par: Par): Par {
  if (par.kind === "number") return { ...par };
  if (par.kind === "menu") return { ...par, options: [...par.options] };
  return { ...par };
}

export function createOpData(family: Family, type: string, label: string): OpData {
  const spec = opSpec(family, type);
  if (!spec) throw new Error(`no operator ${family}:${type}`);
  return {
    kind: "op",
    family,
    type,
    label,
    bypass: false,
    status: "idle",
    error: null,
    pars: spec.pars.map(clonePar),
  };
}

export type ParOverride = number | string | { mode?: ParMode; value?: number; expr?: string };

export function applyParOverrides(pars: Par[], overrides: Record<string, ParOverride> | undefined): Par[] {
  if (!overrides) return pars;
  return pars.map((par) => {
    const next = overrides[par.name];
    if (next == null) return par;
    if (par.kind === "menu" && typeof next === "string" && par.options.includes(next)) return { ...par, value: next };
    if (par.kind === "text" && typeof next === "string") return { ...par, value: next };
    if (par.kind === "number" && typeof next === "number" && Number.isFinite(next)) return { ...par, mode: "constant", value: next };
    if (par.kind === "number" && typeof next === "object") {
      const mode = next.mode === "expression" ? "expression" : "constant";
      return {
        ...par,
        mode,
        value: typeof next.value === "number" && Number.isFinite(next.value) ? next.value : par.value,
        expr: next.expr ?? par.expr,
      };
    }
    return par;
  });
}

export function inletCount(family: Family, type: string): number {
  return opSpec(family, type)?.inputs ?? 0;
}

export function inletHandles(node: InletSource): string[] {
  if (node.kind === "shader") return (node.channels ?? []).map((channel) => `ch${channel}`);
  if (node.kind === "out") return ["ch0"];
  if (node.kind === "audio") return [];
  if (node.kind !== "op" || !node.type) return [];
  const count = inletCount(node.family, node.type);
  return Array.from({ length: count }, (_, index) => `in${index}`);
}

export function hasOutlet(node: InletSource): boolean {
  if (node.kind === "shader" || node.kind === "audio" || node.kind === "out") return true;
  if (node.kind !== "op") return false;
  if (node.family === "MAT" || node.family === "COMP") return false;
  return true;
}

export interface PaletteEntry {
  family: Family;
  type: string;
}

export function paletteEntries(): PaletteEntry[] {
  const ops = OPS.map((spec) => ({ family: spec.family, type: spec.type }));
  return [...ops, { family: "TOP", type: "shader" }, { family: "TOP", type: "audio" }, { family: "TOP", type: "out" }];
}

export const DESCRIBE: Record<string, string> = {
  "CHOP:lfo": "sin(2π·frequency·t)·amp + offset",
  "CHOP:pattern": "sin(2π·phase)·amp; drive phase with an expression",
  "CHOP:audioband": "mean spectrum level between lo..hi (fractions of 512 bins) × gain; synthetic spectrum until a human enables the mic",
  "CHOP:math": "remap: in0 from [from1,from2] to [to1,to2]; add: in0 + in1",
  "CHOP:null": "passes in0; a stable name to reference",
  "POP:pointgen": "n points on a circle or sphere of size s",
  "POP:noise": "adds attribute Noise per point; does not move points; follow with mathmix. t4d animates it",
  "POP:mathmix": "result = A + B·C | A − B | mix(A, B, clamp(C, 0, 1)); a scope is an attribute (P, Noise, an earlier result) or a number",
  "POP:mathcombine": "as mathmix; scopeB must exist upstream, scopeC may name this node's weight par",
  "POP:transform": "translate, rotate (degrees) and scale every point",
  "POP:merge": "concatenates in0 and in1, at most 4096 points total",
  "POP:null": "passes in0",
  "MAT:point": "additive points; color above 1 blooms",
  "COMP:cam": "camera at t looking at look",
  "COMP:geo": "what render draws",
  "TOP:render": "draws the geo's points into an image",
  "TOP:bloom": "glow",
};

function describePar(par: Par): string {
  if (par.kind === "menu") return `${par.name} ${par.options.join("|")}`;
  if (par.kind === "text") return par.ref ? `${par.name} <${par.ref.type ?? par.ref.family} label>` : `${par.name} ${par.value}`;
  return `${par.name} ${par.value} [${par.min}..${par.max}]${par.step === 1 ? " int" : ""}`;
}

export function catalogText(): string {
  const lines = OPS.map((spec) => {
    const pars = spec.pars.length ? spec.pars.map(describePar).join("  ") : "—";
    return `${spec.family.padEnd(4)} ${spec.type.padEnd(12)} inputs ${spec.inputs}   ${pars}   ${DESCRIBE[`${spec.family}:${spec.type}`] ?? ""}`;
  });
  lines.push(
    "TOP  shader       inlets chN for each iChannelN the code reads   params from @range/@color   one GLSL program",
    "TOP  audio        inputs 0   the microphone (or a synthetic pattern) as a 512x2 texture",
    "TOP  out          inlet ch0   the final picture",
  );
  return lines.join("\n");
}
