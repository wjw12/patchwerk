import * as twgl from "twgl.js";
import pointFrag from "../ops/mat/point.frag.glsl?raw";
import pointVert from "../ops/mat/point.vert.glsl?raw";
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
