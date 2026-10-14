// CHOP timeslice: one sample per frame, on the CPU.
// pattern is a sine of its phase parameter (not a ramp). cloud2 drives phase from absTime.

export interface ChopIns {
  a: number | null;
  b: number | null;
}

export function cookChop(
  type: string,
  num: Record<string, number>,
  menu: Record<string, string>,
  inputs: ChopIns,
  seconds: number,
): number {
  const amp = num.amp ?? 1;
  if (type === "lfo") {
    const frequency = num.frequency ?? 1;
    const offset = num.offset ?? 0;
    return Math.sin(Math.PI * 2 * frequency * seconds) * amp + offset;
  }
  if (type === "pattern") {
    const phase = num.phase ?? 0;
    return Math.sin(Math.PI * 2 * phase) * amp;
  }
  if (type === "math") {
    const chopop = menu.chopop ?? "remap";
    if (chopop === "add") {
      if (inputs.a != null && inputs.b != null) return inputs.a + inputs.b;
      return inputs.a ?? inputs.b ?? 0;
    }
    const sample = inputs.a ?? 0;
    const from1 = num.from1 ?? -1;
    const from2 = num.from2 ?? 1;
    const to1 = num.to1 ?? 0;
    const to2 = num.to2 ?? 1;
    const span = from2 - from1;
    const t = span === 0 ? 0 : (sample - from1) / span;
    return to1 + t * (to2 - to1);
  }
  if (type === "null") return inputs.a ?? 0;
  throw new Error(`unknown CHOP ${type}`);
}
