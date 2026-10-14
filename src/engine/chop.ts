// CHOP timeslice: one sample per frame, on the CPU, one or more channels.
// pattern is a sine of its phase parameter (not a ramp). cloud2 drives phase from absTime.
// lag and speed keep state in `prev` (last cook). Pass dt 0 to hold that state.

export const CHOP_CHANNELS = 8;

export interface ChopIns {
  a: Float32Array | null;
  b: Float32Array | null;
  /** This CHOP's output last time the clock moved. */
  prev: Float32Array | null;
  dt: number;
  /** The audio TOP's spectrum row, 0..1 per bin, low to high. */
  spectrum: Float32Array;
}

export function cookChop(
  type: string,
  num: Record<string, number>,
  menu: Record<string, string>,
  inputs: ChopIns,
  seconds: number,
): Float32Array {
  const amp = num.amp ?? 1;
  if (type === "lfo") {
    const frequency = num.frequency ?? 1;
    const offset = num.offset ?? 0;
    return one(Math.sin(Math.PI * 2 * frequency * seconds) * amp + offset);
  }
  if (type === "pattern") {
    const phase = num.phase ?? 0;
    return one(Math.sin(Math.PI * 2 * phase) * amp);
  }
  if (type === "audioband") {
    const bins = inputs.spectrum.length;
    const lo = Math.max(0, Math.min(1, Math.min(num.lo ?? 0, num.hi ?? 1)));
    const hi = Math.max(0, Math.min(1, Math.max(num.lo ?? 0, num.hi ?? 1)));
    const from = Math.min(bins - 1, Math.floor(lo * bins));
    const to = Math.max(from + 1, Math.min(bins, Math.ceil(hi * bins)));
    let sum = 0;
    for (let i = from; i < to; i++) sum += inputs.spectrum[i] ?? 0;
    return one((sum / (to - from)) * (num.gain ?? 1));
  }
  if (type === "math") {
    const chopop = menu.chopop ?? "remap";
    if (chopop === "add") {
      const n = Math.max(inputs.a?.length ?? 0, inputs.b?.length ?? 0, 1);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = at(inputs.a, i) + at(inputs.b, i);
      return out;
    }
    const n = Math.max(inputs.a?.length ?? 1, 1);
    const from1 = num.from1 ?? -1;
    const from2 = num.from2 ?? 1;
    const to1 = num.to1 ?? 0;
    const to2 = num.to2 ?? 1;
    const span = from2 - from1;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = span === 0 ? 0 : (at(inputs.a, i) - from1) / span;
      out[i] = to1 + t * (to2 - to1);
    }
    return out;
  }
  if (type === "null") return copy(inputs.a);
  if (type === "noise") return noiseChop(num, seconds);
  if (type === "lag") return lagChop(num, inputs);
  if (type === "speed") return speedChop(num, menu, inputs);
  throw new Error(`unknown CHOP ${type}`);
}

function one(value: number): Float32Array {
  return Float32Array.of(value);
}

function at(src: Float32Array | null, index: number): number {
  if (!src || index >= src.length) return 0;
  return src[index] ?? 0;
}

function copy(src: Float32Array | null): Float32Array {
  if (!src || src.length === 0) return one(0);
  return new Float32Array(src);
}

/** 1D value noise in 0..1. Channels are the same field with a fixed offset. */
function noiseChop(num: Record<string, number>, seconds: number): Float32Array {
  const count = Math.max(1, Math.min(CHOP_CHANNELS, Math.floor(num.channels ?? 1)));
  const period = Math.max(num.period ?? 1, 1e-4);
  const seed = num.seed ?? 0;
  const rough = num.rough ?? 0;
  const spread = Math.max(num.spread ?? 2, 0.001);
  const amp = num.amp ?? 1;
  const offset = num.offset ?? 0;
  const t = num.t ?? 0;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = seconds / period + t + seed + i * 17.13;
    let n = valueNoise(x);
    if (rough > 0) n = (1 - rough) * n + rough * valueNoise(x * spread + 100);
    out[i] = (n * 2 - 1) * amp + offset;
  }
  return out;
}

/**
 * TD lag: `lag` seconds is about the time to cover 90% of a step.
 * Rising samples use lag1, falling samples use lag2. Zero lag snaps.
 */
function lagChop(num: Record<string, number>, inputs: ChopIns): Float32Array {
  const n = Math.max(inputs.a?.length ?? 1, 1);
  const out = new Float32Array(n);
  const up = num.lag1 ?? 0;
  const down = num.lag2 ?? 0;
  for (let i = 0; i < n; i++) {
    const target = at(inputs.a, i);
    const has = inputs.prev != null && i < inputs.prev.length;
    if (!has) {
      out[i] = target;
      continue;
    }
    const previous = inputs.prev![i] ?? target;
    const lag = target >= previous ? up : down;
    if (lag <= 0) {
      out[i] = target;
      continue;
    }
    if (inputs.dt <= 0) {
      out[i] = previous;
      continue;
    }
    const alpha = 1 - 0.1 ** (inputs.dt / lag);
    out[i] = previous + (target - previous) * alpha;
  }
  return out;
}

/** TD speed: integrate each channel as velocity (units per second). No input integrates `speed`. */
function speedChop(num: Record<string, number>, menu: Record<string, string>, inputs: ChopIns): Float32Array {
  const clamp = menu.limit === "clamp";
  const lo = num.min ?? 0;
  const hi = num.max ?? 1;
  const reset = (num.reset ?? 0) >= 0.5;
  const resetValue = num.resetvalue ?? 0;
  if (!inputs.a) {
    const previous = inputs.prev?.[0] ?? 0;
    let value = reset ? resetValue : previous + (num.speed ?? 1) * Math.max(inputs.dt, 0);
    if (!reset && clamp) value = Math.min(hi, Math.max(lo, value));
    return one(value);
  }
  const n = Math.max(inputs.a.length, 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const previous = inputs.prev && i < inputs.prev.length ? (inputs.prev[i] ?? 0) : 0;
    let value = reset ? resetValue : previous + at(inputs.a, i) * Math.max(inputs.dt, 0);
    if (!reset && clamp) value = Math.min(hi, Math.max(lo, value));
    out[i] = value;
  }
  return out;
}

function valueNoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

function hash1(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
