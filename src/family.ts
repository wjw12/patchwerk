export type Family = "POP" | "CHOP" | "TOP" | "MAT" | "COMP";

export const FAMILIES: Family[] = ["CHOP", "POP", "TOP", "MAT", "COMP"];

/** Header and wire hues. TD literacy is the color; this is not a skin clone. */
export const CHROME: Record<Family, { header: string; wire: string }> = {
  CHOP: { header: "#1f6b45", wire: "#3dcf8a" },
  TOP: { header: "#7a2d6b", wire: "#e07ad4" },
  POP: { header: "#8a4b12", wire: "#f0a040" },
  MAT: { header: "#3d2a7a", wire: "#9b86ff" },
  COMP: { header: "#5a5348", wire: "#c4b8a4" },
};

export function wireStyle(family: Family): { stroke: string; strokeWidth: number } {
  return { stroke: CHROME[family].wire, strokeWidth: 1.8 };
}

export function rfType(family: Family): "chop" | "pop" | "top" | "mat" | "comp" {
  if (family === "CHOP") return "chop";
  if (family === "POP") return "pop";
  if (family === "MAT") return "mat";
  if (family === "COMP") return "comp";
  return "top";
}
