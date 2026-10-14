import * as twgl from "twgl.js";
import mergeFs from "../ops/pop/merge.glsl?raw";
import mathmixFs from "../ops/pop/mathmix.glsl?raw";
import noiseFs from "../ops/pop/noise.glsl?raw";
import pointgenFs from "../ops/pop/pointgen.glsl?raw";
import transformFs from "../ops/pop/transform.glsl?raw";
import { FULLSCREEN_VS } from "./fullscreen";
import { COPY_FS } from "./sources";

export const POP_WIDTH = 256;
const MAX_N = 4096;

interface Slot {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  w: number;
  h: number;
}

export interface PopOut {
  n: number;
  w: number;
  h: number;
  attrs: Map<string, WebGLTexture>;
}

export interface PopJob {
  type: string;
  bypass: boolean;
  num: Record<string, number>;
  menu: Record<string, string>;
  text: Record<string, string>;
  input0: PopOut | null;
  input1: PopOut | null;
}

interface Scope {
  use: number;
  tex: WebGLTexture;
  constant: [number, number, number, number];
}

/**
 * POP attributes are RGBA32F textures, one texel per point.
 * Cook is a fullscreen fragment pass. This file must not call readPixels.
 */
export class PopBank {
  private owned = new Map<string, Map<string, Slot>>();
  private outs = new Map<string, PopOut>();
  private tri: twgl.BufferInfo;
  private copy: twgl.ProgramInfo;
  private pointgen: twgl.ProgramInfo;
  private noise: twgl.ProgramInfo;
  private mathmix: twgl.ProgramInfo;
  private transform: twgl.ProgramInfo;
  private merge: twgl.ProgramInfo;
  private zero: WebGLTexture;

  constructor(private gl: WebGL2RenderingContext) {
    this.tri = twgl.createBufferInfoFromArrays(gl, {
      aPos: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
    });
    this.copy = this.program(FULLSCREEN_VS, COPY_FS);
    this.pointgen = this.program(FULLSCREEN_VS, pointgenFs);
    this.noise = this.program(FULLSCREEN_VS, noiseFs);
    this.mathmix = this.program(FULLSCREEN_VS, mathmixFs);
    this.transform = this.program(FULLSCREEN_VS, transformFs);
    this.merge = this.program(FULLSCREEN_VS, mergeFs);
    this.zero = this.alloc(1, 1).texture;
  }

  get(id: string): PopOut | undefined {
    return this.outs.get(id);
  }

  forget(id: string): void {
    const slots = this.owned.get(id);
    if (slots) {
      for (const slot of slots.values()) this.free(slot);
      this.owned.delete(id);
    }
    this.outs.delete(id);
  }

  /** Frees every POP whose id is not in `alive`. */
  prune(alive: Set<string>): void {
    for (const id of new Set([...this.owned.keys(), ...this.outs.keys()])) {
      if (!alive.has(id)) this.forget(id);
    }
  }

  cook(id: string, job: PopJob): string | null {
    if (job.bypass) {
      if (job.input0) this.outs.set(id, job.input0);
      else if (!this.outs.has(id)) this.outs.set(id, { n: 0, w: 1, h: 1, attrs: new Map() });
      return job.input0 || job.type === "pointgen" ? null : "bypass has no input";
    }
    if (job.type === "pointgen") return this.cookPointgen(id, job);
    if (job.type === "noise") return this.cookNoise(id, job);
    if (job.type === "mathmix" || job.type === "mathcombine") return this.cookMath(id, job);
    if (job.type === "transform") return this.cookTransform(id, job);
    if (job.type === "merge") return this.cookMerge(id, job);
    if (job.type === "null") return this.cookNull(id, job);
    return `unknown POP ${job.type}`;
  }

  private cookPointgen(id: string, job: PopJob): string | null {
    const n = clampN(job.num.n ?? 256);
    const { w, h } = dims(n);
    const slot = this.slot(id, "P", w, h);
    this.draw(this.pointgen, slot, {
      uN: n,
      uWidth: w,
      uShape: job.menu.shape === "sphere" ? 1 : 0,
      uS: job.num.s ?? 0.2,
    });
    this.publish(id, n, w, h, ["P"]);
    return null;
  }

  private cookNoise(id: string, job: PopJob): string | null {
    const input = job.input0;
    const source = input?.attrs.get("P");
    if (!input || !source) return "noise has no P";
    const names = new Set(input.attrs.keys());
    names.add("Noise");
    for (const name of names) {
      if (name === "Noise") continue;
      const from = input.attrs.get(name);
      if (!from) continue;
      this.draw(this.copy, this.slot(id, name, input.w, input.h), { uTex: from });
    }
    this.draw(this.noise, this.slot(id, "Noise", input.w, input.h), {
      sP: source,
      uN: input.n,
      uWidth: input.w,
      uSeed: job.num.seed ?? 0,
      uPeriod: job.num.period ?? 1,
      uHarmon: job.num.harmon ?? 0,
      uSpread: job.num.spread ?? 2,
      uGain: job.num.gain ?? 0.5,
      uAmp: job.num.amp ?? 1,
      uT4d: job.num.t4d ?? 0,
    });
    this.publish(id, input.n, input.w, input.h, [...names]);
    return null;
  }

  private cookMath(id: string, job: PopJob): string | null {
    const input = job.input0;
    if (!input) return `${job.type} has no input`;
    const result = (job.text.result || "P").trim() || "P";
    const A = this.scope(job.text.scopeA ?? "P", input, job.num);
    const B = this.scope(job.text.scopeB ?? "0", input, job.num);
    const C = this.scope(job.text.scopeC ?? "1", input, job.num);
    if ("error" in A) return A.error;
    if ("error" in B) return B.error;
    if ("error" in C) return C.error;
    const names = new Set(input.attrs.keys());
    names.add(result);
    for (const name of names) {
      if (name === result) continue;
      const from = input.attrs.get(name);
      if (!from) continue;
      this.draw(this.copy, this.slot(id, name, input.w, input.h), { uTex: from });
    }
    const oper = job.menu.oper === "asubb" ? 1 : job.menu.oper === "mix" ? 2 : 0;
    this.draw(this.mathmix, this.slot(id, result, input.w, input.h), {
      sA: A.tex,
      sB: B.tex,
      sC: C.tex,
      uA: A.constant,
      uB: B.constant,
      uC: C.constant,
      uUseA: A.use,
      uUseB: B.use,
      uUseC: C.use,
      uOper: oper,
      uN: input.n,
      uWidth: input.w,
    });
    this.publish(id, input.n, input.w, input.h, [...names]);
    return null;
  }

  private cookTransform(id: string, job: PopJob): string | null {
    const input = job.input0;
    const source = input?.attrs.get("P");
    if (!input || !source) return "transform has no P";
    for (const [name, from] of input.attrs) {
      if (name === "P") continue;
      this.draw(this.copy, this.slot(id, name, input.w, input.h), { uTex: from });
    }
    this.draw(this.transform, this.slot(id, "P", input.w, input.h), {
      sP: source,
      uN: input.n,
      uWidth: input.w,
      uT: [job.num.tx ?? 0, job.num.ty ?? 0, job.num.tz ?? 0],
      uR: [job.num.rx ?? 0, job.num.ry ?? 0, job.num.rz ?? 0],
      uS: [job.num.sx ?? 1, job.num.sy ?? 1, job.num.sz ?? 1],
    });
    this.publish(id, input.n, input.w, input.h, [...input.attrs.keys()]);
    return null;
  }

  private cookMerge(id: string, job: PopJob): string | null {
    const a = job.input0;
    const b = job.input1;
    if (!a || !b) return "merge needs two POPs";
    const n = a.n + b.n;
    if (n > MAX_N) return `merge has ${n} points (max ${MAX_N})`;
    const { w, h } = dims(Math.max(n, 1));
    const names = new Set<string>([...a.attrs.keys(), ...b.attrs.keys()]);
    if (names.size === 0) return "merge inputs have no attributes";
    for (const name of names) {
      this.draw(this.merge, this.slot(id, name, w, h), {
        s0: a.attrs.get(name) ?? this.zero,
        s1: b.attrs.get(name) ?? this.zero,
        uN0: a.n,
        uN: n,
        uWidth: w,
      });
    }
    this.publish(id, n, w, h, [...names]);
    return null;
  }

  private cookNull(id: string, job: PopJob): string | null {
    const input = job.input0;
    if (!input) return "null has no input";
    for (const [name, from] of input.attrs) {
      this.draw(this.copy, this.slot(id, name, input.w, input.h), { uTex: from });
    }
    this.publish(id, input.n, input.w, input.h, [...input.attrs.keys()]);
    return null;
  }

  private scope(spec: string, input: PopOut, num: Record<string, number>): Scope | { error: string } {
    const name = spec.trim();
    if (name === "") return { use: 0, tex: this.zero, constant: [0, 0, 0, 0] };
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(name)) {
      const value = Number(name);
      return { use: 0, tex: this.zero, constant: [value, value, value, value] };
    }
    const tex = input.attrs.get(name);
    if (tex) return { use: 1, tex, constant: [0, 0, 0, 0] };
    const value = num[name];
    if (value != null) return { use: 0, tex: this.zero, constant: [value, value, value, value] };
    return { error: `${name} is not an attribute or number` };
  }

  private publish(id: string, n: number, w: number, h: number, names: string[]): void {
    const owned = this.owned.get(id);
    const attrs = new Map<string, WebGLTexture>();
    for (const name of names) {
      const texture = owned?.get(name)?.texture;
      if (texture) attrs.set(name, texture);
    }
    this.outs.set(id, { n, w, h, attrs });
  }

  private slot(id: string, attr: string, w: number, h: number): Slot {
    let owned = this.owned.get(id);
    if (!owned) {
      owned = new Map();
      this.owned.set(id, owned);
    }
    const existing = owned.get(attr);
    if (existing && existing.w === w && existing.h === h) return existing;
    if (existing) this.free(existing);
    const created = this.alloc(w, h);
    owned.set(attr, created);
    return created;
  }

  private alloc(w: number, h: number): Slot {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error("could not allocate a POP attribute");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("RGBA32F framebuffer is incomplete. Refusing to fall back.");
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer, w, h };
  }

  private free(slot: Slot): void {
    this.gl.deleteFramebuffer(slot.framebuffer);
    this.gl.deleteTexture(slot.texture);
  }

  private draw(info: twgl.ProgramInfo, slot: Slot, values: Record<string, unknown>): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, slot.framebuffer);
    gl.viewport(0, 0, slot.w, slot.h);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(info.program);
    twgl.setBuffersAndAttributes(gl, info, this.tri);
    const filtered: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      if (info.uniformSetters[name]) filtered[name] = value;
    }
    twgl.setUniforms(info, filtered);
    twgl.drawBufferInfo(gl, this.tri);
  }

  private program(vertex: string, fragment: string): twgl.ProgramInfo {
    let message = "";
    const info = twgl.createProgramInfo(this.gl, [vertex, fragment], (msg) => {
      message = String(msg);
    });
    if (!info) throw new Error(message || "POP shader failed to compile");
    return info;
  }
}

function clampN(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_N, Math.floor(n)));
}

function dims(n: number): { w: number; h: number } {
  return { w: POP_WIDTH, h: Math.max(1, Math.ceil(n / POP_WIDTH)) };
}
