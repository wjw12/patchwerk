import * as twgl from "twgl.js";
import bloomFs from "../ops/top/bloom.glsl?raw";
import blurFs from "../ops/top/blur.glsl?raw";
import compositeFs from "../ops/top/composite.glsl?raw";
import levelFs from "../ops/top/level.glsl?raw";
import noiseFs from "../ops/top/noise.glsl?raw";
import rampFs from "../ops/top/ramp.glsl?raw";
import transformFs from "../ops/top/transform.glsl?raw";
import { FULLSCREEN_VS } from "./fullscreen";
import { PhongMat, PointMat, type Light, type PhongLook, type PointDraw } from "./mat";
import { COPY_FS } from "./sources";

export const COOK_W = 960;
export const COOK_H = 540;
/** `out` alone draws at 1080p: its passthrough samples the 960×540 cook with linear filtering. */
export const OUT_W = 1920;
export const OUT_H = 1080;
const BLOOM_LEVELS = 5;

export interface CloudDraw {
  p: WebGLTexture;
  n: number;
  view: Float32Array;
  proj: Float32Array;
  viewProj: Float32Array;
  scale: number;
  focus: number;
  alpha: number;
  /** Point MAT color; previews leave it out and draw white. */
  color?: [number, number, number];
  /** Set for a phong MAT: lit opaque spheres instead of additive points. */
  phong?: PhongLook;
  lights?: Light[];
}

export interface BloomPars {
  threshold: number;
  fill: number;
  intensity: number;
  pregamma: number;
}

interface Level {
  w: number;
  h: number;
  target: twgl.FramebufferInfo;
}

/** TOP render (point or phong MAT into RGBA16F) and bloom. POP textures are never read back here. */
export class ImageOps {
  private points: PointMat;
  private phong: PhongMat;
  /** Depth for phong, one per size, attached to a target only while phong draws into it. */
  private depths = new Map<string, WebGLRenderbuffer>();
  private bloom: twgl.ProgramInfo;
  private copy: twgl.ProgramInfo;
  private levelProg: twgl.ProgramInfo;
  private blurProg: twgl.ProgramInfo;
  private compositeProg: twgl.ProgramInfo;
  private transformProg: twgl.ProgramInfo;
  private noiseProg: twgl.ProgramInfo;
  private rampProg: twgl.ProgramInfo;
  /** Horizontal blur lands here so the vertical pass can read it. */
  private blurScratch: twgl.FramebufferInfo | null = null;
  /**
   * Feedback history. `holds` is what a cook reads. `staged` is written at the end of a
   * cook and becomes readable only when absTime moves, so a paused recook cannot feed a
   * TOP its own current image.
   */
  private holds = new Map<string, twgl.FramebufferInfo>();
  private staged = new Map<string, twgl.FramebufferInfo>();
  private tri: twgl.BufferInfo;
  private nodes = new Map<string, twgl.FramebufferInfo>();
  /** Feedback TOP outputs stay RGBA32F. A half float stalls a per-frame integrator. */
  private fullIds = new Set<string>();
  private pyramid: { down: Level[]; up: Level[] } | null = null;
  /** One scratch target per use, so thumbs and the viewer do not reallocate each other every frame. */
  private scratch = new Map<"thumb" | "viewer" | "snapshot", twgl.FramebufferInfo>();

  constructor(private gl: WebGL2RenderingContext) {
    this.points = new PointMat(gl);
    this.phong = new PhongMat(gl);
    this.tri = twgl.createBufferInfoFromArrays(gl, {
      aPos: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
    });
    this.bloom = this.program(FULLSCREEN_VS, bloomFs);
    this.copy = this.program(FULLSCREEN_VS, COPY_FS);
    this.levelProg = this.program(FULLSCREEN_VS, levelFs);
    this.blurProg = this.program(FULLSCREEN_VS, blurFs);
    this.compositeProg = this.program(FULLSCREEN_VS, compositeFs);
    this.transformProg = this.program(FULLSCREEN_VS, transformFs);
    this.noiseProg = this.program(FULLSCREEN_VS, noiseFs);
    this.rampProg = this.program(FULLSCREEN_VS, rampFs);
  }

  forget(id: string): void {
    const target = this.nodes.get(id);
    if (target) freeTarget(this.gl, target);
    this.nodes.delete(id);
    this.fullIds.delete(id);
  }

  /** Frees every node target and feedback hold whose id is not in `alive`. */
  prune(alive: Set<string>): void {
    for (const id of [...this.nodes.keys()]) {
      if (!alive.has(id)) this.forget(id);
    }
    for (const id of new Set([...this.holds.keys(), ...this.staged.keys()])) {
      if (!alive.has(id)) this.forgetHold(id);
    }
  }

  /** Playbar reset. The next cook has no feedback history. */
  dropHolds(): void {
    for (const id of new Set([...this.holds.keys(), ...this.staged.keys()])) this.forgetHold(id);
  }

  /**
   * Publish the snapshots taken on the previous timestamp. Call only when absTime moved,
   * before this cook reads `held`.
   */
  commitHolds(): void {
    const readable = this.holds;
    this.holds = this.staged;
    this.staged = readable;
  }

  private forgetHold(id: string): void {
    for (const map of [this.holds, this.staged]) {
      const target = map.get(id);
      if (target) freeTarget(this.gl, target);
      map.delete(id);
    }
  }

  image(id: string): { tex: WebGLTexture; w: number; h: number } | null {
    const target = this.nodes.get(id);
    const tex = target?.attachments[0] as WebGLTexture | undefined;
    if (!target || !tex) return null;
    return { tex, w: target.width, h: target.height };
  }

  /** Clears a node's image to black, for a TOP that cannot cook. `full` is RGBA32F. */
  blank(id: string, full = false): { tex: WebGLTexture; w: number; h: number } {
    const target = this.nodeTarget(id, COOK_W, COOK_H, full);
    this.clear(target);
    return { tex: target.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  /** Phong layers first so they share a depth buffer, then additive point layers. */
  render(id: string, layers: CloudDraw[]): { tex: WebGLTexture; w: number; h: number } {
    const target = this.nodeTarget(id, COOK_W, COOK_H);
    const ordered = [...layers.filter((layer) => layer.phong && layer.n >= 1), ...layers.filter((layer) => !layer.phong && layer.n >= 1)];
    if (ordered.length === 0) {
      this.clear(target);
      return { tex: target.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
    }
    ordered.forEach((layer, index) => this.drawCloud(layer, target, COOK_W, COOK_H, layer.color ?? [1, 1, 1], index === 0));
    return { tex: target.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  /** Same point MAT into a small float target. Used for the node thumb and the orbit viewer. */
  preview(slot: "thumb" | "viewer" | "snapshot", cloud: CloudDraw | null, w: number, h: number): WebGLTexture {
    const width = Math.max(2, w);
    const height = Math.max(2, h);
    let target = this.scratch.get(slot);
    if (!target || target.width !== width || target.height !== height) {
      if (target) freeTarget(this.gl, target);
      target = this.allocate(width, height);
      this.scratch.set(slot, target);
    }
    if (!cloud || cloud.n < 1) {
      this.clear(target);
      return target.attachments[0] as WebGLTexture;
    }
    this.drawCloud(cloud, target, width, height, [1, 1, 1], true);
    return target.attachments[0] as WebGLTexture;
  }

  private drawCloud(
    cloud: CloudDraw,
    target: twgl.FramebufferInfo,
    width: number,
    height: number,
    color: [number, number, number],
    clear: boolean,
  ): void {
    if (cloud.phong) {
      this.phong.draw({ ...cloud, look: cloud.phong, lights: cloud.lights ?? [], depth: this.depth(width, height), target, width, height, clear });
      return;
    }
    const draw: PointDraw = { ...cloud, color, target, width, height, clear };
    this.points.draw(draw);
  }

  private depth(w: number, h: number): WebGLRenderbuffer {
    const key = `${w}x${h}`;
    const existing = this.depths.get(key);
    if (existing) {
      // Most recent last, so resizing previews evicts an old size and never the cook's.
      this.depths.delete(key);
      this.depths.set(key, existing);
      return existing;
    }
    const gl = this.gl;
    const buffer = gl.createRenderbuffer();
    if (!buffer) throw new Error("could not create a depth buffer");
    gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    // Previews resize with their panel; keep only a few sizes around.
    if (this.depths.size >= 6) {
      const [oldKey, old] = this.depths.entries().next().value as [string, WebGLRenderbuffer];
      gl.deleteRenderbuffer(old);
      this.depths.delete(oldKey);
    }
    this.depths.set(key, buffer);
    return buffer;
  }

  bloomPass(id: string, source: WebGLTexture, sourceW: number, sourceH: number, pars: BloomPars): { tex: WebGLTexture; w: number; h: number } {
    const { down, up } = this.levels();
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    const common = { uThreshold: pars.threshold, uFill: pars.fill, uPregamma: pars.pregamma };
    // Down: source -> down[0] (threshold) -> down[1] -> ... each a 13-tap filter of the level above.
    let tex = source;
    let w = sourceW;
    let h = sourceH;
    down.forEach((level, index) => {
      this.shade(this.bloom, level.target, true, { ...common, uTex: tex, uTexel: [1 / w, 1 / h], uPass: index === 0 ? 0 : 1 });
      tex = level.target.attachments[0] as WebGLTexture;
      w = level.w;
      h = level.h;
    });
    // Up: up[i] = mix(down[i], tent(up[i + 1]), fill), starting from the smallest down level.
    for (let index = up.length - 1; index >= 0; index--) {
      const level = up[index]!;
      this.shade(this.bloom, level.target, true, {
        ...common,
        uTex: tex,
        uTexel: [1 / w, 1 / h],
        uBase: down[index]!.target.attachments[0],
        uPass: 2,
      });
      tex = level.target.attachments[0] as WebGLTexture;
      w = level.w;
      h = level.h;
    }
    this.shade(this.bloom, out, true, { uScene: source, uTex: tex, uIntensity: pars.intensity, uPass: 3 });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  copyImage(id: string, source: WebGLTexture, full = false): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H, full);
    this.shade(this.copy, out, true, { uTex: source });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  level(
    id: string,
    source: WebGLTexture,
    pars: { invert: number; blacklevel: number; brightness: number; gamma: number; contrast: number; opacity: number },
  ): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    this.shade(this.levelProg, out, true, {
      uTex: source,
      uInvert: pars.invert,
      uBlack: pars.blacklevel,
      uBrightness: pars.brightness,
      uGamma: pars.gamma,
      uContrast: pars.contrast,
      uOpacity: pars.opacity,
    });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  blur(id: string, source: WebGLTexture, size: number, extend: number, box: boolean): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    if (size <= 0) {
      this.shade(this.copy, out, true, { uTex: source });
      return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
    }
    const scratch = this.blurTarget();
    const common = { uSize: size, uExtend: extend, uBox: box ? 1 : 0 };
    this.shade(this.blurProg, scratch, true, { ...common, uTex: source, uDir: [1 / COOK_W, 0] });
    this.shade(this.blurProg, out, true, { ...common, uTex: scratch.attachments[0], uDir: [0, 1 / COOK_H] });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  composite(id: string, a: WebGLTexture, b: WebGLTexture, op: number): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    this.shade(this.compositeProg, out, true, { uA: a, uB: b, uOp: op });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  transform(
    id: string,
    source: WebGLTexture,
    pars: { tx: number; ty: number; rotate: number; sx: number; sy: number; extend: number; bg: [number, number, number] },
  ): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    this.shade(this.transformProg, out, true, {
      uTex: source,
      uTx: pars.tx,
      uTy: pars.ty,
      uRot: (pars.rotate * Math.PI) / 180,
      uSx: pars.sx,
      uSy: pars.sy,
      uBg: pars.bg,
      uExtend: pars.extend,
    });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  /** Copies `source` into the staged hold. It is readable from `held` after `commitHolds`. */
  hold(id: string, source: WebGLTexture, w: number, h: number): void {
    let target = this.staged.get(id);
    if (!target || target.width !== w || target.height !== h) {
      if (target) freeTarget(this.gl, target);
      target = this.allocate(w, h, true);
      this.staged.set(id, target);
    }
    this.shade(this.copy, target, true, { uTex: source });
  }

  held(id: string): { tex: WebGLTexture; w: number; h: number } | null {
    const target = this.holds.get(id);
    const tex = target?.attachments[0] as WebGLTexture | undefined;
    if (!target || !tex) return null;
    return { tex, w: target.width, h: target.height };
  }

  noise(
    id: string,
    pars: { seed: number; period: number; harmon: number; spread: number; gain: number; amp: number; offset: number; t4d: number; mono: boolean },
  ): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    this.shade(this.noiseProg, out, true, {
      uSeed: pars.seed,
      uPeriod: pars.period,
      uHarmon: pars.harmon,
      uSpread: pars.spread,
      uGain: pars.gain,
      uAmp: pars.amp,
      uOffset: pars.offset,
      uT4d: pars.t4d,
      uMono: pars.mono ? 1 : 0,
    });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  ramp(
    id: string,
    pars: { type: number; phase: number; period: number; extend: number; color0: [number, number, number]; color1: [number, number, number] },
  ): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    this.shade(this.rampProg, out, true, {
      uType: pars.type,
      uPhase: pars.phase,
      uPeriod: pars.period,
      uExtend: pars.extend,
      uColor0: pars.color0,
      uColor1: pars.color1,
    });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  private blurTarget(): twgl.FramebufferInfo {
    if (this.blurScratch && this.blurScratch.width === COOK_W && this.blurScratch.height === COOK_H) return this.blurScratch;
    if (this.blurScratch) freeTarget(this.gl, this.blurScratch);
    this.blurScratch = this.allocate(COOK_W, COOK_H);
    return this.blurScratch;
  }

  /** Half, quarter, ... a 32nd of the cook size; `up` has one level fewer than `down`. */
  private levels(): { down: Level[]; up: Level[] } {
    if (this.pyramid) return this.pyramid;
    const make = (w: number, h: number): Level => ({ w, h, target: this.allocate(w, h) });
    const down: Level[] = [];
    for (let shift = 1; shift <= BLOOM_LEVELS; shift++) {
      down.push(make(Math.max(1, Math.round(COOK_W / 2 ** shift)), Math.max(1, Math.round(COOK_H / 2 ** shift))));
    }
    const up = down.slice(0, -1).map((level) => make(level.w, level.h));
    this.pyramid = { down, up };
    return this.pyramid;
  }

  private nodeTarget(id: string, w: number, h: number, full = false): twgl.FramebufferInfo {
    const existing = this.nodes.get(id);
    if (existing && existing.width === w && existing.height === h && this.fullIds.has(id) === full) return existing;
    if (existing) freeTarget(this.gl, existing);
    const created = this.allocate(w, h, full);
    this.nodes.set(id, created);
    if (full) this.fullIds.add(id);
    else this.fullIds.delete(id);
    return created;
  }

  private allocate(w: number, h: number, full = false): twgl.FramebufferInfo {
    const gl = this.gl;
    const attach = {
      internalFormat: full ? gl.RGBA32F : gl.RGBA16F,
      format: gl.RGBA,
      type: full ? gl.FLOAT : gl.HALF_FLOAT,
      min: gl.LINEAR,
      mag: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    };
    let target = twgl.createFramebufferInfo(gl, [attach], w, h);
    twgl.bindFramebufferInfo(gl, target);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      freeTarget(gl, target);
      target = twgl.createFramebufferInfo(gl, [{ ...attach, min: gl.NEAREST, mag: gl.NEAREST }], w, h);
      twgl.bindFramebufferInfo(gl, target);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("float framebuffer is incomplete");
      }
    }
    this.clear(target);
    return target;
  }

  private clear(target: twgl.FramebufferInfo): void {
    const gl = this.gl;
    twgl.bindFramebufferInfo(gl, target);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private shade(
    info: twgl.ProgramInfo,
    target: twgl.FramebufferInfo,
    clear: boolean,
    values: Record<string, unknown>,
    add = false,
  ): void {
    const gl = this.gl;
    twgl.bindFramebufferInfo(gl, target);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    if (add) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.disable(gl.BLEND);
    }
    if (clear && !add) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.useProgram(info.program);
    twgl.setBuffersAndAttributes(gl, info, this.tri);
    const filtered: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      if (info.uniformSetters[name]) filtered[name] = value;
    }
    twgl.setUniforms(info, filtered);
    twgl.drawBufferInfo(gl, this.tri);
    gl.disable(gl.BLEND);
  }

  private program(vertex: string, fragment: string): twgl.ProgramInfo {
    let message = "";
    const info = twgl.createProgramInfo(this.gl, [vertex, fragment], (msg) => {
      message = String(msg);
    });
    if (!info) throw new Error(message || "image shader failed to compile");
    return info;
  }
}

/** Deletes a twgl framebuffer and the textures or renderbuffers attached to it. */
export function freeTarget(gl: WebGL2RenderingContext, target: twgl.FramebufferInfo): void {
  gl.deleteFramebuffer(target.framebuffer);
  for (const attachment of target.attachments) {
    if (attachment instanceof WebGLTexture) gl.deleteTexture(attachment);
    else if (attachment instanceof WebGLRenderbuffer) gl.deleteRenderbuffer(attachment);
  }
}
