// CHOP timeslice: one sample per frame, on the CPU.
// pattern is a sine of its phase parameter (not a ramp). cloud2 drives phase from absTime.

export interface ChopIns {
  a: number | null;
  b: number | null;
  /** The audio TOP's spectrum row, 0..1 per bin, low to high. */
  spectrum: Float32Array;
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
  if (type === "audioband") {
    // Mean level of the spectrum between lo and hi (fractions of the bins), times gain.
    const bins = inputs.spectrum.length;
    const lo = Math.max(0, Math.min(1, Math.min(num.lo ?? 0, num.hi ?? 1)));
    const hi = Math.max(0, Math.min(1, Math.max(num.lo ?? 0, num.hi ?? 1)));
    const from = Math.min(bins - 1, Math.floor(lo * bins));
    const to = Math.max(from + 1, Math.min(bins, Math.ceil(hi * bins)));
    let sum = 0;
    for (let i = from; i < to; i++) sum += inputs.spectrum[i] ?? 0;
    return (sum / (to - from)) * (num.gain ?? 1);
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
