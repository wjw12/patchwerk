import * as twgl from "twgl.js";
import bloomFs from "../ops/top/bloom.glsl?raw";
import { FULLSCREEN_VS } from "./fullscreen";
import { PointMat, type PointDraw } from "./mat";
import { COPY_FS } from "./sources";

export const COOK_W = 960;
export const COOK_H = 540;

export interface CloudDraw {
  p: WebGLTexture;
  n: number;
  view: Float32Array;
  viewProj: Float32Array;
  scale: number;
  focus: number;
  alpha: number;
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
  private pyramid: { bright: Level; mid: Level; far: Level; blur: Level } | null = null;
  /** One scratch target per use, so thumbs and the viewer do not reallocate each other every frame. */
  private scratch = new Map<"thumb" | "viewer", twgl.FramebufferInfo>();

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

  render(id: string, cloud: CloudDraw | null): { tex: WebGLTexture; w: number; h: number } {
    const target = this.nodeTarget(id, COOK_W, COOK_H);
    if (!cloud || cloud.n < 1) {
      this.clear(target);
      return { tex: target.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
    }
    const draw: PointDraw = {
      ...cloud,
      color: [1, 1, 1],
      target,
      width: COOK_W,
      height: COOK_H,
    };
    this.points.draw(draw);
    return { tex: target.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  /** Same point MAT into a small float target. Used for the node thumb and the orbit viewer. */
  preview(slot: "thumb" | "viewer", cloud: CloudDraw | null, w: number, h: number): WebGLTexture {
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
    const pyramid = this.levels();
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    const common = {
      uScene: source,
      uThreshold: pars.threshold,
      uFill: pars.fill,
      uIntensity: pars.intensity,
      uPregamma: pars.pregamma,
    };
    this.shade(this.bloom, pyramid.bright.target, true, {
      ...common,
      uTex: source,
      uTexel: [1 / sourceW, 1 / sourceH],
      uPass: 0,
    });
    this.shade(this.bloom, pyramid.mid.target, true, {
      ...common,
      uTex: pyramid.bright.target.attachments[0],
      uTexel: [1 / pyramid.bright.w, 1 / pyramid.bright.h],
      uPass: 1,
    });
    this.shade(this.bloom, pyramid.far.target, true, {
      ...common,
      uTex: pyramid.mid.target.attachments[0],
      uTexel: [1 / pyramid.mid.w, 1 / pyramid.mid.h],
      uPass: 1,
    });
    this.shade(this.bloom, pyramid.blur.target, true, {
      ...common,
      uTex: pyramid.far.target.attachments[0],
      uTexel: [1 / pyramid.far.w, 1 / pyramid.far.h],
      uPass: 2,
    });
    this.shade(
      this.copy,
      pyramid.blur.target,
      false,
      { uTex: pyramid.bright.target.attachments[0] },
      true,
    );
    this.shade(this.bloom, out, true, {
      uScene: source,
      uTex: pyramid.blur.target.attachments[0],
      uIntensity: pars.intensity,
      uPass: 3,
    });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  copyImage(id: string, source: WebGLTexture): { tex: WebGLTexture; w: number; h: number } {
    const out = this.nodeTarget(id, COOK_W, COOK_H);
    this.shade(this.copy, out, true, { uTex: source });
    return { tex: out.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  private levels(): { bright: Level; mid: Level; far: Level; blur: Level } {
    if (this.pyramid) return this.pyramid;
    const make = (w: number, h: number): Level => ({ w, h, target: this.allocate(w, h) });
    this.pyramid = {
      bright: make(480, 270),
      mid: make(240, 135),
      far: make(120, 67),
      blur: make(480, 270),
    };
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
