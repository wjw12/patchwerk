import * as twgl from "twgl.js";
import pointFrag from "../ops/mat/point.frag.glsl?raw";
import pointVert from "../ops/mat/point.vert.glsl?raw";
import phongFrag from "../ops/mat/phong.frag.glsl?raw";
import phongVert from "../ops/mat/phong.vert.glsl?raw";
import { POP_WIDTH } from "./pop";

export interface PointDraw {
  p: WebGLTexture;
  n: number;
  view: Float32Array;
  viewProj: Float32Array;
  scale: number;
  focus: number;
  alpha: number;
  color: [number, number, number];
  target: twgl.FramebufferInfo;
  width: number;
  height: number;
}

type Vec3 = [number, number, number];

/** A light COMP in world space; color already carries the dimmer. */
export interface Light {
  kind: "point" | "distant" | "ambient";
  pos: Vec3;
  color: Vec3;
}

export interface PhongLook {
  diff: Vec3;
  spec: Vec3;
  amb: Vec3;
  emit: Vec3;
  shininess: number;
}

export interface PhongDraw extends Omit<PointDraw, "alpha" | "color"> {
  look: PhongLook;
  lights: Light[];
  depth: WebGLRenderbuffer;
}

const MAX_LIGHTS = 4;

/** Additive point sprites. gl_PointSize from view-space distance and focus. No pixel readback. */
export class PointMat {
  private info: twgl.ProgramInfo;
  private vao: WebGLVertexArrayObject;

  constructor(private gl: WebGL2RenderingContext) {
    let message = "";
    const info = twgl.createProgramInfo(gl, [pointVert, pointFrag], (msg) => {
      message = String(msg);
    });
    if (!info) throw new Error(message || "point MAT failed to compile");
    this.info = info;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("could not create a point VAO");
    this.vao = vao;
  }

  draw(args: PointDraw): void {
    const gl = this.gl;
    twgl.bindFramebufferInfo(gl, args.target);
    gl.viewport(0, 0, args.width, args.height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.info.program);
    gl.bindVertexArray(this.vao);
    twgl.setUniforms(this.info, {
      sP: args.p,
      uView: args.view,
      uViewProj: args.viewProj,
      uScale: args.scale,
      uFocus: args.focus,
      uWidth: POP_WIDTH,
      uAlpha: args.alpha,
      uColor: args.color,
    });
    gl.drawArrays(gl.POINTS, 0, Math.max(0, args.n));
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}

/** Opaque lit sphere sprites with a depth buffer. Lights go to view space here, once per draw. */
export class PhongMat {
  private info: twgl.ProgramInfo;
  private vao: WebGLVertexArrayObject;

  constructor(private gl: WebGL2RenderingContext) {
    let message = "";
    const info = twgl.createProgramInfo(gl, [phongVert, phongFrag], (msg) => {
      message = String(msg);
    });
    if (!info) throw new Error(message || "phong MAT failed to compile");
    this.info = info;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("could not create a phong VAO");
    this.vao = vao;
  }

  draw(args: PhongDraw): void {
    const gl = this.gl;
    twgl.bindFramebufferInfo(gl, args.target);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, args.depth);
    gl.viewport(0, 0, args.width, args.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pos = new Float32Array(MAX_LIGHTS * 4);
    const color = new Float32Array(MAX_LIGHTS * 3);
    const ambient: Vec3 = [0, 0, 0];
    const direct = args.lights.filter((light) => light.kind !== "ambient").slice(0, MAX_LIGHTS);
    for (const light of args.lights) {
      if (light.kind !== "ambient") continue;
      ambient[0] += light.color[0];
      ambient[1] += light.color[1];
      ambient[2] += light.color[2];
    }
    const v = args.view;
    direct.forEach((light, index) => {
      const [x, y, z] = light.pos;
      // Column-major: a point gets the translation, a direction does not.
      const w = light.kind === "point" ? 1 : 0;
      pos[index * 4] = v[0]! * x + v[4]! * y + v[8]! * z + v[12]! * w;
      pos[index * 4 + 1] = v[1]! * x + v[5]! * y + v[9]! * z + v[13]! * w;
      pos[index * 4 + 2] = v[2]! * x + v[6]! * y + v[10]! * z + v[14]! * w;
      pos[index * 4 + 3] = w;
      color.set(light.color, index * 3);
    });
    // No light at all: a headlight at the camera, so a fresh phong is never black.
    let count = direct.length;
    if (args.lights.length === 0) {
      pos.set([0, 0, 0, 1], 0);
      color.set([1, 1, 1], 0);
      count = 1;
    }
    gl.useProgram(this.info.program);
    gl.bindVertexArray(this.vao);
    twgl.setUniforms(this.info, {
      sP: args.p,
      uView: args.view,
      uViewProj: args.viewProj,
      uScale: args.scale,
      uFocus: args.focus,
      uWidth: POP_WIDTH,
      uDiff: args.look.diff,
      uSpec: args.look.spec,
      uAmb: args.look.amb,
      uEmit: args.look.emit,
      uShininess: args.look.shininess,
      uAmbient: ambient,
      uLightCount: count,
      uLightPos: pos,
      uLightColor: color,
    });
    gl.drawArrays(gl.POINTS, 0, Math.max(0, args.n));
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
  }
}
