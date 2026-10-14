import * as twgl from "twgl.js";
import bloomFs from "../ops/top/bloom.glsl?raw";
import { FULLSCREEN_VS } from "./fullscreen";
import { PointMat, type PointDraw } from "./mat";
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
  viewProj: Float32Array;
  scale: number;
  focus: number;
  alpha: number;
  /** Point MAT color; previews leave it out and draw white. */
  color?: [number, number, number];
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

/** TOP render (point MAT into RGBA16F) and bloom. POP textures are never read back here. */
export class ImageOps {
  private points: PointMat;
  private bloom: twgl.ProgramInfo;
  private copy: twgl.ProgramInfo;
  private tri: twgl.BufferInfo;
  private nodes = new Map<string, twgl.FramebufferInfo>();
  private pyramid: { down: Level[]; up: Level[] } | null = null;
  /** One scratch target per use, so thumbs and the viewer do not reallocate each other every frame. */
  private scratch = new Map<"thumb" | "viewer" | "snapshot", twgl.FramebufferInfo>();

  constructor(private gl: WebGL2RenderingContext) {
    this.points = new PointMat(gl);
    this.tri = twgl.createBufferInfoFromArrays(gl, {
      aPos: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
    });
    this.bloom = this.program(FULLSCREEN_VS, bloomFs);
    this.copy = this.program(FULLSCREEN_VS, COPY_FS);
  }

  forget(id: string): void {
    const target = this.nodes.get(id);
    if (target) freeTarget(this.gl, target);
    this.nodes.delete(id);
  }

  /** Frees every node target whose id is not in `alive`. */
  prune(alive: Set<string>): void {
    for (const id of [...this.nodes.keys()]) {
      if (!alive.has(id)) this.forget(id);
    }
  }

  image(id: string): { tex: WebGLTexture; w: number; h: number } | null {
    const target = this.nodes.get(id);
    const tex = target?.attachments[0] as WebGLTexture | undefined;
    if (!target || !tex) return null;
    return { tex, w: target.width, h: target.height };
  }

  /** Clears a node's image to black, for a TOP that cannot cook. */
  blank(id: string): { tex: WebGLTexture; w: number; h: number } {
    const target = this.nodeTarget(id, COOK_W, COOK_H);
    this.clear(target);
    return { tex: target.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  render(id: string, cloud: CloudDraw | null): { tex: WebGLTexture; w: number; h: number } {
    const target = this.nodeTarget(id, COOK_W, COOK_H);
    if (!cloud || cloud.n < 1) {
      this.clear(target);
      return { tex: target.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
    }
    const draw: PointDraw = {
      ...cloud,
      color: cloud.color ?? [1, 1, 1],
      target,
      width: COOK_W,
      height: COOK_H,
    };
    this.points.draw(draw);
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
    this.points.draw({ ...cloud, color: [1, 1, 1], target, width, height });
    return target.attachments[0] as WebGLTexture;
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

  copyImage(id: string, source: WebGLTexture): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    this.shade(this.copy, out, true, { uTex: source });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
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

  private nodeTarget(id: string, w: number, h: number): twgl.FramebufferInfo {
    const existing = this.nodes.get(id);
    if (existing && existing.width === w && existing.height === h) return existing;
    if (existing) freeTarget(this.gl, existing);
    const created = this.allocate(w, h);
    this.nodes.set(id, created);
    return created;
  }

  private allocate(w: number, h: number): twgl.FramebufferInfo {
    const gl = this.gl;
    const attach = {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
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
