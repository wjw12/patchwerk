import type { NumberPar, Par } from "../ops/catalog";

/** One row of the parameter panel: a lone parameter, or tx/ty/tz, colorr/g/b, from1/from2 as one row. */
export type ParItem = { kind: "single"; par: Par } | { kind: "vector"; label: string; color: boolean; pars: NumberPar[] };

// Suffix sets that make a vector, in the order the catalog lists them.
const SUFFIXES = [
  ["x", "y", "z"],
  ["x", "y"],
  ["r", "g", "b"],
  ["1", "2"],
];

const PREFIX_LABELS: Record<string, string> = {
  t: "translate",
  r: "rotate",
  s: "scale",
  look: "look at",
  color: "color",
  diff: "diffuse",
  spec: "specular",
  amb: "ambient",
  emit: "emit",
  from: "from range",
  to: "to range",
  lag: "lag",
  color0: "color 0",
  color1: "color 1",
  bg: "background",
};

const LABELS: Record<string, string> = {
  chopop: "operation",
  oper: "operation",
  lo: "low",
  hi: "high",
  n: "points",
  harmon: "harmonics",
  t4d: "time 4D",
  scopeA: "scope A",
  scopeB: "scope B",
  scopeC: "scope C",
  lighttype: "light type",
  coneangle: "cone angle",
  conedelta: "cone delta",
  pregamma: "pre-gamma",
  geo: "geometry",
  geometry: "geometry",
  camera: "camera",
  pop: "POP",
  mat: "material",
  cam: "camera",
  blacklevel: "black level",
  lag1: "lag up",
  lag2: "lag down",
  resetvalue: "reset value",
  channels: "channels",
};

/** A readable label; the parameter's own name (what expressions and the assistant use) is the tooltip. */
export function parLabel(name: string, type?: string): string {
  // pointgen's s is a radius; a transform's s never stands alone.
  if (name === "s" && type === "pointgen") return "radius";
  return LABELS[name] ?? name;
}

export function groupPars(pars: Par[]): ParItem[] {
  const items: ParItem[] = [];
  for (let index = 0; index < pars.length; index++) {
    const par = pars[index]!;
    const group = par.kind === "number" ? vectorAt(pars, index) : null;
    if (group) {
      items.push(group.item);
      index += group.item.pars.length - 1;
    } else {
      items.push({ kind: "single", par });
    }
  }
  return items;
}

function vectorAt(pars: Par[], index: number): { item: Extract<ParItem, { kind: "vector" }> } | null {
  const first = pars[index]!;
  for (const suffixes of SUFFIXES) {
    if (!first.name.endsWith(suffixes[0]!)) continue;
    const prefix = first.name.slice(0, -1);
    const label = PREFIX_LABELS[prefix];
    if (!label) continue;
    const run = suffixes.map((suffix, offset) => pars[index + offset]);
    const fits = run.every((par, offset) => par?.kind === "number" && par.name === prefix + suffixes[offset]);
    if (!fits) continue;
    return { item: { kind: "vector", label, color: suffixes[0] === "r", pars: run as NumberPar[] } };
  }
  return null;
}
