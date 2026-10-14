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

/** A light COMP in world space; color already carries the dimmer. Cone angles are in degrees. */
export interface Light {
  kind: "point" | "distant" | "cone" | "ambient";
  pos: Vec3;
  look: Vec3;
  color: Vec3;
  coneangle: number;
  conedelta: number;
}

export interface PhongLook {
  /** Sphere radius in world units. */
  size: number;
  diff: Vec3;
  spec: Vec3;
  amb: Vec3;
  emit: Vec3;
  shininess: number;
}

export interface PhongDraw {
  p: WebGLTexture;
  n: number;
  view: Float32Array;
  proj: Float32Array;
  look: PhongLook;
  lights: Light[];
  depth: WebGLRenderbuffer;
  target: twgl.FramebufferInfo;
  width: number;
  height: number;
}

const MAX_LIGHTS = 8;
const LIGHT_CODE = { distant: 0, point: 1, cone: 2 } as const;

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

/** Opaque lit spheres, ray-traced inside point sprites, with a depth buffer. Lights go to view space here, once per draw. */
export class PhongMat {
  private info: twgl.ProgramInfo;
  private vao: WebGLVertexArrayObject;
  private maxPoint: number;

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
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
    this.maxPoint = range?.[1] ?? 64;
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
    const axis = new Float32Array(MAX_LIGHTS * 4);
    const color = new Float32Array(MAX_LIGHTS * 4);
    const ambient: Vec3 = [0, 0, 0];
    for (const light of args.lights) {
      if (light.kind !== "ambient") continue;
      ambient[0] += light.color[0];
      ambient[1] += light.color[1];
      ambient[2] += light.color[2];
    }
    const direct = args.lights.filter((light) => light.kind !== "ambient").slice(0, MAX_LIGHTS);
    direct.forEach((light, index) => {
      if (light.kind === "ambient") return; // narrows the kind; ambients were filtered out
      const along = sub(light.look, light.pos);
      // A distant light is a direction toward the light; point and cone lights are positions.
      const at = light.kind === "distant" ? toView(args.view, normalize(scale(along, -1)), 0) : toView(args.view, light.pos, 1);
      pos.set([...at, LIGHT_CODE[light.kind]], index * 4);
      const half = (Math.max(0, light.coneangle) / 2) * (Math.PI / 180);
      const outer = Math.min(Math.PI, half + Math.max(0, light.conedelta) * (Math.PI / 180));
      axis.set([...toView(args.view, normalize(along), 0), Math.cos(outer)], index * 4);
      // The inner edge must sit inside the outer one or smoothstep has no ramp.
      color.set([...light.color, Math.max(Math.cos(half), Math.cos(outer) + 1e-4)], index * 4);
    });
    // No light at all: a headlight at the camera, so a fresh phong is never black.
    let count = direct.length;
    if (args.lights.length === 0) {
      pos.set([0, 0, 0, LIGHT_CODE.point], 0);
      color.set([1, 1, 1, 1], 0);
      count = 1;
    }
    gl.useProgram(this.info.program);
    gl.bindVertexArray(this.vao);
    twgl.setUniforms(this.info, {
      sP: args.p,
      uView: args.view,
      uProj: args.proj,
      uSize: Math.max(1e-4, args.look.size),
      uViewport: [args.width, args.height],
      uMaxPoint: this.maxPoint,
      uWidth: POP_WIDTH,
      uDiff: args.look.diff,
      uSpec: args.look.spec,
      uAmb: args.look.amb,
      uEmit: args.look.emit,
      uShininess: args.look.shininess,
      uAmbient: ambient,
      uLightCount: count,
      uLightPos: pos,
      uLightAxis: axis,
      uLightColor: color,
    });
    gl.drawArrays(gl.POINTS, 0, Math.max(0, args.n));
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
  }
}

/** A world-space point (w = 1) or direction (w = 0) in view space. The view matrix is column-major. */
function toView(v: Float32Array, [x, y, z]: Vec3, w: number): Vec3 {
  return [
    v[0]! * x + v[4]! * y + v[8]! * z + v[12]! * w,
    v[1]! * x + v[5]! * y + v[9]! * z + v[13]! * w,
    v[2]! * x + v[6]! * y + v[10]! * z + v[14]! * w,
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** A light on its own look point has no direction; it shines down -y. */
function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length < 1e-6 ? [0, -1, 0] : scale(a, 1 / length);
}
