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
  ref?: { family: Family; type?: string; pattern?: boolean };
}

/** Whether a name parameter names this label: the whole value, or one word of a pattern like render.lights. */
export function namesLabel(par: TextPar, label: string): boolean {
  if (!par.ref) return false;
  if (!par.ref.pattern) return par.value === label;
  return par.value.split(/[\s,]+/).includes(label);
}

/** The value after `old` is renamed to `next`; a pattern keeps its other words and wildcards. */
export function renamedValue(par: TextPar, old: string, next: string): string {
  if (!par.ref?.pattern) return par.value === old ? next : par.value;
  return par.value.replace(/[^\s,]+/g, (word) => (word === old ? next : word));
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
const pattern = (name: string, value: string, family: Family, type?: string): TextPar => ({ kind: "text", name, value, ref: { family, type, pattern: true } });

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
    family: "CHOP",
    type: "lag",
    inputs: 1,
    pars: [num("lag1", 0.2, 0, 4), num("lag2", 0.2, 0, 4)],
  },
  {
    family: "CHOP",
    type: "speed",
    inputs: 1,
    pars: [
      num("speed", 1, -8, 8),
      menu("limit", "off", ["off", "clamp"]),
      num("min", 0, -8, 8),
      num("max", 1, -8, 8),
      num("reset", 0, 0, 1, 1),
      num("resetvalue", 0, -8, 8),
    ],
  },
  {
    family: "CHOP",
    type: "noise",
    inputs: 0,
    pars: [
      num("channels", 1, 1, 8, 1),
      num("seed", 0, 0, 64),
      num("period", 1, 0.01, 8),
      num("rough", 0, 0, 1),
      num("spread", 2, 1, 4),
      num("amp", 1, 0, 4),
      num("offset", 0, -2, 2),
      num("t", 0, -8, 8),
    ],
  },
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
    family: "MAT",
    type: "phong",
    inputs: 0,
    pars: [
      num("size", 0.05, 0.001, 1),
      num("diffr", 1, 0, 4),
      num("diffg", 1, 0, 4),
      num("diffb", 1, 0, 4),
      num("specr", 1, 0, 4),
      num("specg", 1, 0, 4),
      num("specb", 1, 0, 4),
      num("shininess", 40, 1, 256),
      num("ambr", 0.15, 0, 4),
      num("ambg", 0.15, 0, 4),
      num("ambb", 0.15, 0, 4),
      num("emitr", 0, 0, 4),
      num("emitg", 0, 0, 4),
      num("emitb", 0, 0, 4),
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
    type: "light",
    inputs: 0,
    pars: [
      menu("lighttype", "point", ["point", "distant", "cone", "ambient"]),
      num("tx", 3, -20, 20),
      num("ty", 4, -20, 20),
      num("tz", 5, -40, 40),
      num("lookx", 0, -20, 20),
      num("looky", 0, -20, 20),
      num("lookz", 0, -40, 40),
      num("colorr", 1, 0, 4),
      num("colorg", 1, 0, 4),
      num("colorb", 1, 0, 4),
      num("dimmer", 1, 0, 8),
      num("coneangle", 45, 1, 180),
      num("conedelta", 10, 0, 90),
    ],
  },
  {
    family: "COMP",
    type: "geo",
    inputs: 0,
    pars: [ref("pop", "POP"), ref("mat", "MAT")],
  },
  {
    family: "TOP",
    type: "render",
    inputs: 0,
    pars: [pattern("geometry", "*", "COMP", "geo"), pattern("camera", "*", "COMP", "cam"), pattern("lights", "*", "COMP", "light")],
  },
  {
    family: "TOP",
    type: "bloom",
    inputs: 1,
    pars: [num("threshold", 0.01, 0, 1), num("fill", 0.72, 0, 1), num("intensity", 1.24, 0, 4), num("pregamma", 1.5, 0.2, 4)],
  },
  {
    family: "TOP",
    type: "level",
    inputs: 1,
    pars: [
      menu("invert", "off", ["off", "on"]),
      num("blacklevel", 0, 0, 1),
      num("brightness", 0, -1, 1),
      num("gamma", 1, 0.2, 4),
      num("contrast", 1, 0, 4),
      num("opacity", 1, 0, 1),
    ],
  },
  {
    family: "TOP",
    type: "blur",
    inputs: 1,
    pars: [menu("type", "gaussian", ["gaussian", "box"]), num("size", 8, 0, 64), menu("extend", "hold", ["hold", "zero", "repeat", "mirror"])],
  },
  {
    family: "TOP",
    type: "composite",
    inputs: 2,
    pars: [
      menu("operand", "over", ["over", "add", "multiply", "subtract", "difference", "screen", "max", "min"]),
      menu("swap", "off", ["off", "on"]),
    ],
  },
  {
    family: "TOP",
    type: "transform",
    inputs: 1,
    pars: [
      num("tx", 0, -2, 2),
      num("ty", 0, -2, 2),
      num("rotate", 0, -360, 360),
      num("sx", 1, 0, 4),
      num("sy", 1, 0, 4),
      menu("extend", "hold", ["hold", "zero", "repeat", "mirror"]),
      num("bgr", 0, 0, 1),
      num("bgg", 0, 0, 1),
      num("bgb", 0, 0, 1),
    ],
  },
  {
    family: "TOP",
    type: "feedback",
    inputs: 1,
    pars: [ref("top", "TOP"), num("reset", 0, 0, 1, 1)],
  },
  {
    family: "TOP",
    type: "noise",
    inputs: 0,
    pars: [
      num("seed", 0, 0, 64),
      num("period", 0.25, 0.01, 4),
      num("harmon", 1, 0, 2, 1),
      num("spread", 2, 1, 4),
      num("gain", 0.5, 0, 2),
      num("amp", 0.5, 0, 4),
      num("offset", 0.5, -1, 2),
      num("t4d", 0, -8, 8),
      menu("mono", "off", ["off", "on"]),
    ],
  },
  {
    family: "TOP",
    type: "ramp",
    inputs: 0,
    pars: [
      menu("type", "vertical", ["vertical", "horizontal", "radial"]),
      num("phase", 0, -4, 4),
      num("period", 1, 0.05, 8),
      menu("extend", "hold", ["hold", "repeat", "mirror"]),
      num("color0r", 0, 0, 1),
      num("color0g", 0, 0, 1),
      num("color0b", 0, 0, 1),
      num("color1r", 1, 0, 1),
      num("color1g", 1, 0, 1),
      num("color1b", 1, 0, 1),
    ],
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

/**
 * A render saved before camera moved off the geo has `geo` (one label) and no `geometry`.
 * The cam is `cam` on that geo. Copy both onto the current pars when the new keys were
 * never stored, so an old room does not become geometry `*` / camera `*`.
 */
export function migrateLegacyRenders(
  nodes: { id: string; data: { kind: string; type?: string; label: string; pars?: Par[] } }[],
  stored: (id: string, name: string) => string | null,
): void {
  for (const node of nodes) {
    if (node.data.kind !== "op" || node.data.type !== "render" || !node.data.pars) continue;
    const legacyGeo = stored(node.id, "geo");
    if (!legacyGeo || stored(node.id, "geometry") != null) continue;
    setTextPar(node.data.pars, "geometry", legacyGeo);
    if (stored(node.id, "camera") != null) continue;
    const geo = nodes.find((item) => item.data.kind === "op" && item.data.type === "geo" && item.data.label === legacyGeo);
    const cam = geo ? stored(geo.id, "cam") : null;
    if (cam) setTextPar(node.data.pars, "camera", cam);
  }
}

function setTextPar(pars: Par[], name: string, value: string): void {
  const par = pars.find((item) => item.name === name);
  if (par?.kind === "text") par.value = value;
}

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
  if (node.kind === "audio" || node.kind === "webcam") return [];
  if (node.kind !== "op" || !node.type) return [];
  const count = inletCount(node.family, node.type);
  return Array.from({ length: count }, (_, index) => `in${index}`);
}

export function hasOutlet(node: InletSource): boolean {
  if (node.kind === "shader" || node.kind === "audio" || node.kind === "webcam" || node.kind === "out") return true;
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
  return [...ops, { family: "TOP", type: "shader" }, { family: "TOP", type: "audio" }, { family: "TOP", type: "webcam" }, { family: "TOP", type: "out" }];
}

export const DESCRIBE: Record<string, string> = {
  "CHOP:lfo": "sin(2π·frequency·t)·amp + offset",
  "CHOP:pattern": "sin(2π·phase)·amp; drive phase with an expression",
  "CHOP:audioband": "mean spectrum level between lo..hi (fractions of 512 bins) × gain; synthetic spectrum until a human enables the mic",
  "CHOP:math": "remap: in0 from [from1,from2] to [to1,to2]; add: in0 + in1",
  "CHOP:null": "passes every channel of in0; a stable name to reference",
  "CHOP:lag": "follows in0. lag1 seconds to cover ~90% of a rise, lag2 of a fall, per channel",
  "CHOP:speed": "integrates in0 as velocity (units/second), one output channel per input channel; with no input, integrates the speed par",
  "CHOP:noise": "1..8 channels of value noise. chan1 is channel 0; op('noise1')['chan2'] reads the second",
  "POP:pointgen": "n points on a circle or sphere of size s",
  "POP:noise": "adds attribute Noise per point; does not move points; follow with mathmix. t4d animates it",
  "POP:mathmix": "result = A + B·C | A − B | mix(A, B, clamp(C, 0, 1)); a scope is an attribute (P, Noise, an earlier result) or a number",
  "POP:mathcombine": "as mathmix; scopeB must exist upstream, scopeC may name this node's weight par",
  "POP:transform": "translate, rotate (degrees) and scale every point",
  "POP:merge": "concatenates in0 and in1, at most 4096 points total",
  "POP:null": "passes in0",
  "MAT:point": "additive glowing sprites, no depth, ignores lights; color above 1 blooms",
  "MAT:phong": "every point is a solid sphere of radius size (world units), ray-traced with true depth: ambient·amb + Σ light·(diff·N·L + spec·(N·H)^shininess) + emit; lit by light COMPs (without one a headlight sits at the camera)",
  "COMP:cam": "camera at t looking at look",
  "COMP:light": "lights phong MATs. point: at t, all directions; distant: parallel rays from t toward look; cone: a spotlight at t aimed at look; ambient: lifts everything by color. dimmer scales color",
  "COMP:geo": "one object a render draws: a POP and a MAT. The camera lives on the render",
  "TOP:render": "draws every geo COMP its geometry pattern matches, through its own camera. Phong geos first (depth), then additive point geos. lights is * or labels; only phong uses them",
  "TOP:bloom": "glow",
  "TOP:level": "black level, brightness, gamma, contrast, then opacity. invert flips rgb first",
  "TOP:blur": "gaussian or box blur. size is the sigma in pixels (box: the radius)",
  "TOP:composite": "in0 operand in1. over is premultiplied; add stacks two renders",
  "TOP:transform": "moves, rotates and scales in0. tx/ty are fractions of the frame",
  "TOP:feedback": "with reset 0, outputs the previous frame of the TOP named by top. reset 1 passes in0. Point top at a downstream TOP; do not wire a cycle",
  "TOP:noise": "value noise image. t4d animates it. mono off is a different field per channel",
  "TOP:ramp": "two-color ramp: vertical, horizontal or radial",
};

/** What the less obvious parameters do; catalogText prints it under the op for the assistant. */
export const PAR_NOTES: Record<string, string> = {
  "CHOP:lfo": "frequency in Hz",
  "CHOP:pattern": "phase in cycles; e.g. phase = absTime.seconds*0.5",
  "CHOP:math": "in1 is only read by add",
  "POP:pointgen": "s is the radius; n is floored to an integer",
  "POP:noise": "period: feature size in world units; harmon: extra octaves (0..2); spread: frequency step per octave; gain: amplitude step per octave; amp: overall scale; t4d: 4th noise dimension, animate it with absTime.seconds; seed shifts the field",
  "POP:mathmix": "scope names: P (position), Noise (from a noise POP), any earlier result name, or a literal number; oper mix weights by C",
  "POP:mathcombine": "same math as mathmix; a scope may also name one of this node's number pars (scopeC weight), so weight can be driven by an expression",
  "POP:transform": "applied scale, then rotate x→y→z, then translate",
  "MAT:point": "on-screen size is scale·(1 + focus/distance) pixels at the 960x540 cook, clamped to 1..64; alpha and color multiply the additive glow. Reads only P: every point gets the same color",
  "MAT:phong": "size is the sphere radius in world units, so spheres shrink with distance like geometry; about half the point spacing reads as a solid surface. diff: diffuse color; spec: specular highlight color; shininess: highlight tightness (higher is smaller); amb: how much ambient light it takes; emit: self-lit color. Reads only P. At most 8 point/distant/cone lights count; ambient lights add up",
  "COMP:cam": "t is the eye position, look is the point it aims at; fov is vertical, in degrees",
  "COMP:light": "lighttype point|distant|cone|ambient; t is the position, look the point a distant or cone light aims at (default the origin); an ambient light ignores both. coneangle is the full cone in degrees, conedelta the soft edge added outside it. color × dimmer is the light; no falloff with distance",
  "CHOP:lag": "lag1 when the input is above the output, lag2 when it is below, in seconds. 0 snaps. Every input channel is lagged on its own",
  "CHOP:speed": "first-order integral, the TD Speed CHOP: output += input * dt. limit clamp holds the result in [min, max]. reset 1 sets every channel to resetvalue. No input: one channel ramps at `speed` per second",
  "CHOP:noise": "channels is how many (chan1..chanN, max 8). period is seconds between peaks; t is an extra translate (drive it, or leave 0 and let seconds move the field); rough mixes a second octave at `spread`; amp and offset scale the -1..1 noise",
  "COMP:geo": "pop and mat are labels of a POP and a MAT. A render's geometry pattern names this geo; the camera is the render's, not the geo's",
  "TOP:render": "geometry and camera are patterns (* = all, or labels and globs separated by spaces). The first matching cam is the one camera this TOP draws; a second camera needs its own render. An older node that still has geo (one label) and no camera uses that geo and the cam stored on it. lights matches light COMP labels (default * = all). Cooks at 960x540; out shows it at 1920x1080",
  "TOP:bloom": "threshold: brightness that starts to glow (the 0.01 default glows nearly everything, right for sparse point glow; raise to ~0.8 after phong so only highlights glow); fill: how far it spreads; intensity: glow added back; pregamma: contrast before thresholding",
  "TOP:level": "blacklevel: pixels at or below this become black and the rest stretch up. brightness adds. gamma 1 is unchanged, above 1 darkens. contrast 1 is unchanged, scaled around 0.5. opacity multiplies rgb and alpha. Not the Range/RGBA/Step pages",
  "TOP:blur": "type gaussian|box. size is pixels (gaussian: sigma). extend hold|zero|repeat|mirror. Horizontal then vertical; sizes above 16 space the taps so the width is still real",
  "TOP:composite": "operand over|add|multiply|subtract|difference|screen|max|min. swap on exchanges the inputs. over of two opaque pictures shows in0; use add to layer renders",
  "TOP:transform": "order is rotate, scale, then translate, about the center. extend zero shows bgr/bgg/bgb outside the image; hold clamps; repeat and mirror tile",
  "TOP:feedback": "top is a TOP label (a shader, a render, another filter). The cook reads last frame, so the downstream chain can use this output and feed that TOP without a wire cycle. Empty top is an error while reset is 0",
  "TOP:noise": "period is the feature size in frame-fractions. harmon 0..2 extra octaves. Same field family as POP noise, evaluated on pixels",
  "TOP:ramp": "phase shifts the stops, period stretches them. extend hold|repeat|mirror. color0 is t=0, color1 is t=1",
};

function describePar(par: Par): string {
  if (par.kind === "menu") return `${par.name} ${par.options.join("|")}`;
  if (par.kind === "text" && par.ref?.pattern) return `${par.name} ${par.value} <${par.ref.type ?? par.ref.family} labels, * wildcards>`;
  if (par.kind === "text") return par.ref ? `${par.name} <${par.ref.type ?? par.ref.family} label>` : `${par.name} ${par.value}`;
  return `${par.name} ${par.value} [${par.min}..${par.max}]${par.step === 1 ? " int" : ""}`;
}

export function catalogText(): string {
  const lines = OPS.map((spec) => {
    const key = `${spec.family}:${spec.type}`;
    const pars = spec.pars.length ? spec.pars.map(describePar).join("  ") : "—";
    const head = `${spec.family.padEnd(4)} ${spec.type.padEnd(12)} inputs ${spec.inputs}   ${pars}   ${DESCRIBE[key] ?? ""}`;
    return PAR_NOTES[key] ? `${head}\n${" ".repeat(18)}${PAR_NOTES[key]}` : head;
  });
  lines.push(
    "TOP  shader       inlets chN for each iChannelN the code reads   params from @range/@color   one GLSL program",
    "TOP  audio        inputs 0   the microphone (or a synthetic pattern) as a 512x2 texture",
    "TOP  webcam       inputs 0   this tab's camera (or a moving test picture) at the cook size, upright",
    "TOP  out          inlet ch0   the final picture",
  );
  return lines.join("\n");
}
