import * as twgl from "twgl.js";
import { CAPTURE_H, CAPTURE_W } from "../capture";
import { encodeBytes, publish } from "../probe";
import type { Launch } from "../session";
import { useGraph } from "../store";
import type { PNode } from "../store";
import { FULLSCREEN_VS } from "./fullscreen";
import { COPY_FS, PASSTHROUGH } from "./sources";
import { compilerErrors, parseShader, wrapShader, type ShaderParam } from "./wrap";

const COOK_W = 960;
const COOK_H = 540;
const TEST_W = 48;
const TEST_H = 48;
const THUMB_W = 160;
const THUMB_H = 90;

export interface Cursor {
  x: number;
  y: number;
  down: boolean;
}

interface Runtime {
  source: string;
  info: twgl.ProgramInfo;
  front: twgl.FramebufferInfo;
  back: twgl.FramebufferInfo | null;
}

export class Engine {
  private gl: WebGL2RenderingContext | null = null;
  private tri: twgl.BufferInfo | null = null;
  private copy: twgl.ProgramInfo | null = null;
  private programs = new Map<string, twgl.ProgramInfo>();
  private runtime = new Map<string, Runtime>();
  private drafts = new Map<string, string>();
  private timers = new Map<string, number>();
  private previews = new Map<string, CanvasRenderingContext2D>();
  private viewer: HTMLCanvasElement | null = null;
  private viewerCtx: CanvasRenderingContext2D | null = null;
  private black: WebGLTexture | null = null;
  private pattern: WebGLTexture | null = null;
  private audioTex: WebGLTexture | null = null;
  private audioPixels = new Uint8Array(512 * 2 * 4);
  private testTarget: twgl.FramebufferInfo | null = null;
  private analyser: AnalyserNode | null = null;
  private freq = new Float32Array(512);
  private wave = new Float32Array(512);
  private pointer = { x: 0.5, y: 0.5, down: false, seen: false, clickX: 0, clickY: 0 };
  private roomCursors: Cursor[] = [];
  /** Fires on every local pointer change over the viewer; the room layer publishes it. */
  onPointer: ((cursor: Cursor) => void) | null = null;
  private booting = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private frame = 0;
  private failed = "";
  private abort = new AbortController();
  private generation = 0;
  private launch: Launch = { graph: null, t: 0, frames: 1, fixed: false, viewer: "out" };
  private dt = 1 / 60;
  private present = true;
  private frameMs = 0;

  attach(canvas: HTMLCanvasElement, launch?: Launch): void {
    this.stop();
    this.launch = launch ?? this.launch;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      this.failFixed("WebGL2 is missing. Open this in desktop Edge or Chrome.");
      return;
    }
    if (!gl.getExtension("EXT_color_buffer_float")) {
      this.failFixed("EXT_color_buffer_float is missing. Refusing to fall back to RGBA8.");
      return;
    }
    gl.getExtension("OES_texture_float_linear");
    this.gl = gl;
    const signal = this.abort.signal;
    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        this.failed = "WebGL context lost. Restoring the last good shaders.";
        this.programs.clear();
        this.runtime.clear();
      },
      { signal },
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        this.failed = "";
        this.programs.clear();
        this.runtime.clear();
        this.drafts.clear();
        try {
          this.initResources();
          this.booting = true;
          this.watchDrafts(useGraph.getState().nodes);
          this.booting = false;
        } catch (error) {
          this.fail(error instanceof Error ? error.message : "WebGL restore failed");
        }
      },
      { signal },
    );
    try {
      this.initResources();
      this.boot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "WebGL init failed";
      this.fail(message);
      if (this.launch.fixed) publish({ ready: true, error: message, width: 0, height: 0, rgba: "" });
      return;
    }
    this.last = performance.now();
    if (this.launch.fixed) {
      const generation = this.generation;
      void this.runFixed(generation);
      return;
    }
    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.dt = dt;
      this.time += dt;
      this.frame += 1;
      this.frameMs += (dt * 1000 - this.frameMs) * 0.2;
      const stats = document.getElementById("stats");
      if (stats) stats.textContent = `${this.frameMs.toFixed(2)} ms`;
      try {
        this.cook();
      } catch (error) {
        this.failed = error instanceof Error ? error.message : "cook failed";
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.generation += 1;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.abort.abort();
    this.abort = new AbortController();
    this.unsub?.();
    this.unsub = null;
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
    this.gl = null;
    this.programs.clear();
    this.runtime.clear();
    this.drafts.clear();
    this.copy = null;
    this.tri = null;
  }

  invalidate(): void {
    this.drafts.clear();
    if (this.gl) this.watchDrafts(useGraph.getState().nodes);
  }

  private async runFixed(generation: number): Promise<void> {
    const shaders = useGraph.getState().nodes.filter((node) => node.data.kind === "shader");
    const broken = shaders.filter((node) => node.data.kind === "shader" && node.data.status !== "live");
    if (broken.length) {
      const error = broken
        .map((node) => `${node.data.label}: ${node.data.kind === "shader" ? (node.data.error ?? "did not compile") : ""}`)
        .join("\n");
      this.finishFixed(generation, { ready: true, error, width: 0, height: 0, rgba: "" });
      return;
    }
    const frames = this.launch.frames;
    const end = this.launch.t;
    this.dt = 1 / 60;
    this.pointer.seen = false;
    this.clearCookTargets();
    for (let i = 1; i <= frames; i++) {
      if (generation !== this.generation) return;
      this.frame = i;
      this.time = end - (frames - i) * this.dt;
      this.present = i === frames;
      try {
        this.cook();
      } catch (error) {
        const message = error instanceof Error ? error.message : "cook failed";
        this.finishFixed(generation, { ready: true, error: message, width: 0, height: 0, rgba: "" });
        return;
      }
      if (i !== frames) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (generation !== this.generation) return;
    if (this.failed) {
      this.finishFixed(generation, { ready: true, error: this.failed, width: 0, height: 0, rgba: "" });
      return;
    }
    try {
      this.capture(this.launch.viewer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "readPixels failed";
      this.finishFixed(generation, { ready: true, error: message, width: 0, height: 0, rgba: "" });
    }
    const stats = document.getElementById("stats");
    if (stats) stats.textContent = `frame ${frames} · t ${end.toFixed(2)}`;
  }

  private finishFixed(generation: number, probe: { ready: boolean; error: string | null; width: number; height: number; rgba: string }): void {
    if (generation !== this.generation) return;
    publish(probe);
  }

  private capture(viewerId: string): void {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) throw new Error("WebGL context is gone");
    const runtime = this.runtime.get(viewerId);
    if (!runtime) throw new Error(`no cooked output for ${viewerId}`);
    const x = Math.floor((COOK_W - CAPTURE_W) / 2);
    const y = Math.floor((COOK_H - CAPTURE_H) / 2);
    twgl.bindFramebufferInfo(gl, runtime.front);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    const raw = new Uint16Array(CAPTURE_W * CAPTURE_H * 4);
    gl.getError();
    gl.readPixels(x, y, CAPTURE_W, CAPTURE_H, gl.RGBA, gl.HALF_FLOAT, raw);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(`HALF_FLOAT readPixels failed (gl ${error}). RGBA16F readback is required; not falling back to RGBA8.`);
    }
    const rgba = new Uint8Array(CAPTURE_W * CAPTURE_H * 4);
    for (let row = 0; row < CAPTURE_H; row++) {
      const srcRow = (CAPTURE_H - 1 - row) * CAPTURE_W;
      const dstRow = row * CAPTURE_W;
      for (let col = 0; col < CAPTURE_W; col++) {
        const src = (srcRow + col) * 4;
        const dst = (dstRow + col) * 4;
        rgba[dst] = quantize(raw[src] ?? 0);
        rgba[dst + 1] = quantize(raw[src + 1] ?? 0);
        rgba[dst + 2] = quantize(raw[src + 2] ?? 0);
        rgba[dst + 3] = 255;
      }
    }
    this.finishFixed(this.generation, { ready: true, error: null, width: CAPTURE_W, height: CAPTURE_H, rgba: encodeBytes(rgba) });
  }

  private clearCookTargets(): void {
    for (const runtime of this.runtime.values()) {
      this.clearTarget(runtime.front);
      if (runtime.back) this.clearTarget(runtime.back);
    }
  }

  private failFixed(message: string): void {
    this.fail(message);
    if (this.launch.fixed) publish({ ready: true, error: message, width: 0, height: 0, rgba: "" });
  }

  setPreview(id: string, canvas: HTMLCanvasElement | null): void {
    if (!canvas) {
      this.previews.delete(id);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) this.previews.set(id, ctx);
  }

  /** Other people's cursors, normalized like the local one. They fill iCursors after ours. */
  setRoomCursors(cursors: Cursor[]): void {
    this.roomCursors = cursors.slice(0, 7);
  }

  setViewer(canvas: HTMLCanvasElement | null): void {
    if (canvas === this.viewer) return;
    this.viewer = canvas;
    this.viewerCtx = canvas?.getContext("2d") ?? null;
    if (!canvas) return;
    canvas.addEventListener("pointerdown", (event) => {
      this.pointer.down = true;
      this.track(canvas, event);
      this.pointer.clickX = this.pointer.x;
      this.pointer.clickY = this.pointer.y;
      this.emitPointer();
    });
    canvas.addEventListener("pointerup", () => {
      this.pointer.down = false;
      this.emitPointer();
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer.down = false;
      this.emitPointer();
    });
    canvas.addEventListener("pointermove", (event) => this.track(canvas, event));
  }

  async enableMic(): Promise<void> {
    try {
      const audio = new AudioContext();
      await audio.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audio.createMediaStreamSource(stream);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      this.analyser = analyser;
      useGraph.getState().setMic("live");
    } catch {
      useGraph.getState().setMic("denied");
    }
  }

  private boot(): void {
    this.booting = true;
    const unsub = useGraph.subscribe((state) => this.watchDrafts(state.nodes));
    this.unsub = unsub;
    this.watchDrafts(useGraph.getState().nodes);
    this.booting = false;
  }

  private unsub: (() => void) | null = null;

  private watchDrafts(nodes: PNode[]): void {
    for (const node of nodes) {
      if (node.data.kind !== "shader") continue;
      if (this.drafts.get(node.id) === node.data.draft) continue;
      this.drafts.set(node.id, node.data.draft);
      if (this.booting) this.tryCommit(node.id);
      else this.schedule(node.id);
    }
  }

  private schedule(id: string): void {
    const prev = this.timers.get(id);
    if (prev) window.clearTimeout(prev);
    this.timers.set(
      id,
      window.setTimeout(() => this.tryCommit(id), 320),
    );
  }

  private tryCommit(id: string): void {
    try {
      this.commit(id);
    } catch (error) {
      useGraph.getState().applyCompile(id, {
        status: "error",
        error: error instanceof Error ? error.message : "compile failed",
      });
    }
  }

  private commit(id: string): void {
    const gl = this.gl;
    if (!gl) return;
    const node = useGraph.getState().nodes.find((item) => item.id === id);
    if (!node || node.data.kind !== "shader") return;
    const parsed = parseShader(node.data.draft);
    if (parsed.staticError) {
      useGraph.getState().applyCompile(id, { status: "error", error: parsed.staticError });
      return;
    }
    const wrapped = wrapShader(node.data.draft);
    const compiled = this.compile(wrapped.source);
    if ("error" in compiled) {
      useGraph.getState().applyCompile(id, {
        status: "error",
        error: compilerErrors(compiled.error, wrapped.userLines),
      });
      return;
    }
    const bad = this.testOutput(compiled.info, parsed.params);
    if (bad) {
      gl.deleteProgram(compiled.info.program);
      useGraph.getState().applyCompile(id, { status: "error", error: bad });
      return;
    }
    this.programs.set(hash(wrapped.source), compiled.info);
    this.install(id, node.data.draft, compiled.info, parsed.feedback);
    useGraph.getState().applyCompile(id, { status: "live", error: null, committed: node.data.draft });
  }

  private cook(): void {
    const gl = this.gl;
    const canvas = gl?.canvas as HTMLCanvasElement | undefined;
    if (!gl || gl.isContextLost() || !canvas || !this.tri || !this.copy || !this.black) return;
    const { nodes, edges } = useGraph.getState();
    for (const id of this.runtime.keys()) {
      if (!nodes.some((node) => node.id === id)) this.runtime.delete(id);
    }
    const selected = nodes.find((node) => node.selected) ?? nodes.find((node) => node.id === "out");
    this.fillAudio();
    const order = topo(nodes, edges);
    for (const id of order) {
      const node = nodes.find((item) => item.id === id);
      if (!node) continue;
      if (node.data.kind === "audio") continue;
      const source = node.data.kind === "out" ? PASSTHROUGH : node.data.committed;
      if (!source) continue;
      const parsed = parseShader(source);
      const wrapped = wrapShader(source);
      let info = this.programs.get(hash(wrapped.source));
      if (!info) {
        const compiled = this.compile(wrapped.source);
        if ("error" in compiled) continue;
        info = compiled.info;
        this.programs.set(hash(wrapped.source), info);
      }
      const rt = this.install(id, source, info, node.data.kind === "shader" && parsed.feedback);
      const target = rt.back ?? rt.front;
      const previous = rt.front;
      this.draw(info, target, this.uniformsFor(node, parsed.params, parsed.feedback, previous, edges, nodes));
      if (rt.back) {
        rt.front = rt.back;
        rt.back = previous;
      }
    }
    if (this.present) {
      if ((this.frame & 1) === 0 || this.launch.fixed) this.blitPreviews(nodes);
      if (selected && this.viewer && this.viewerCtx) this.blitViewer(selected);
    }
    const hud = document.getElementById("hud");
    if (hud) {
      const live = nodes.filter((node) => node.data.kind !== "shader" || node.data.status === "live").length;
      hud.textContent = this.failed || `${live}/${nodes.length} live · ${COOK_W}×${COOK_H} · ${this.frame}`;
    }
  }

  private uniformsFor(
    node: PNode,
    params: ShaderParam[],
    feedback: boolean,
    previous: twgl.FramebufferInfo,
    edges: { source: string; target: string; targetHandle?: string | null }[],
    nodes: PNode[],
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {
      iResolution: [COOK_W, COOK_H, 1],
      iTime: this.time,
      iTimeDelta: this.dt,
      iFrame: this.frame,
      iMouse: [
        this.pointer.x * COOK_W,
        this.pointer.y * COOK_H,
        (this.pointer.down ? 1 : -1) * Math.max(this.pointer.clickX, 0.0001) * COOK_W,
        this.pointer.clickY * COOK_H,
      ],
      iCursorCount: (this.pointer.seen ? 1 : 0) + this.roomCursors.length,
      iCursors: cursorArray(this.pointer.seen ? [this.pointer, ...this.roomCursors] : this.roomCursors),
    };
    const resolutions = new Float32Array(12);
    for (let channel = 0; channel < 4; channel++) {
      let tex = this.black;
      let w = 1;
      let h = 1;
      if (feedback && channel === 3) {
        tex = previous.attachments[0] as WebGLTexture;
        w = COOK_W;
        h = COOK_H;
      } else {
        const edge = edges.find((item) => item.target === node.id && item.targetHandle === `ch${channel}`);
        if (edge) {
          const upstream = nodes.find((item) => item.id === edge.source);
          const output = upstream ? this.outputTexture(upstream) : null;
          if (output) {
            tex = output.tex;
            w = output.w;
            h = output.h;
          }
        }
      }
      values[`iChannel${channel}`] = tex;
      resolutions[channel * 3] = w;
      resolutions[channel * 3 + 1] = h;
      resolutions[channel * 3 + 2] = 1;
    }
    values.iChannelResolution = resolutions;
    const live = node.data.kind === "shader" ? node.data.params : params;
    for (const param of live) {
      values[param.name] = param.kind === "float" ? param.value : param.value;
    }
    return values;
  }

  private outputTexture(node: PNode): { tex: WebGLTexture; w: number; h: number } | null {
    if (node.data.kind === "audio" && this.audioTex) return { tex: this.audioTex, w: 512, h: 2 };
    const rt = this.runtime.get(node.id);
    if (!rt) return null;
    return { tex: rt.front.attachments[0] as WebGLTexture, w: COOK_W, h: COOK_H };
  }

  private blitPreviews(nodes: PNode[]): void {
    const gl = this.gl;
    const canvas = gl?.canvas as HTMLCanvasElement | undefined;
    if (!gl || !canvas || !this.copy) return;
    this.ensureDrawingBuffer(Math.max(THUMB_W, this.viewerPixels().w), Math.max(THUMB_H, this.viewerPixels().h));
    for (const node of nodes) {
      const ctx = this.previews.get(node.id);
      const output = this.outputTexture(node);
      if (!ctx || !output) continue;
      this.blitTexture(output.tex, THUMB_W, THUMB_H);
      const y = gl.drawingBufferHeight - THUMB_H;
      ctx.drawImage(canvas, 0, y, THUMB_W, THUMB_H, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  private blitViewer(node: PNode): void {
    const gl = this.gl;
    const canvas = gl?.canvas as HTMLCanvasElement | undefined;
    const dest = this.viewer;
    const ctx = this.viewerCtx;
    if (!gl || !canvas || !dest || !ctx) return;
    const output = this.outputTexture(node);
    if (!output) return;
    const size = this.viewerPixels();
    this.ensureDrawingBuffer(Math.max(size.w, THUMB_W), Math.max(size.h, THUMB_H));
    dest.width = size.w;
    dest.height = size.h;
    this.blitTexture(output.tex, size.w, size.h);
    ctx.drawImage(canvas, 0, gl.drawingBufferHeight - size.h, size.w, size.h, 0, 0, size.w, size.h);
  }

  private blitTexture(tex: WebGLTexture, w: number, h: number): void {
    const gl = this.gl;
    if (!gl || !this.copy || !this.tri) return;
    twgl.bindFramebufferInfo(gl, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.copy.program);
    twgl.setBuffersAndAttributes(gl, this.copy, this.tri);
    this.setKnownUniforms(this.copy, { uTex: tex });
    twgl.drawBufferInfo(gl, this.tri);
  }

  private draw(info: twgl.ProgramInfo, target: twgl.FramebufferInfo, values: Record<string, unknown>): void {
    const gl = this.gl;
    if (!gl || !this.tri) return;
    twgl.bindFramebufferInfo(gl, target);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(info.program);
    twgl.setBuffersAndAttributes(gl, info, this.tri);
    this.setKnownUniforms(info, values);
    twgl.drawBufferInfo(gl, this.tri);
  }

  private testOutput(info: twgl.ProgramInfo, params: ShaderParam[]): string | null {
    const gl = this.gl;
    if (!gl || !this.testTarget || !this.pattern || !this.black) return "test framebuffer missing";
    const values: Record<string, unknown> = {
      iResolution: [TEST_W, TEST_H, 1],
      iTime: 0.35,
      iTimeDelta: 0.016,
      iFrame: 3,
      iMouse: [TEST_W * 0.5, TEST_H * 0.4, TEST_W * 0.5, TEST_H * 0.4],
      iCursorCount: 1,
      iCursors: cursorArray([{ x: 0.45, y: 0.55, down: true }]),
      iChannelResolution: new Float32Array([32, 32, 1, 32, 32, 1, 32, 32, 1, 32, 32, 1]),
    };
    for (let channel = 0; channel < 4; channel++) values[`iChannel${channel}`] = this.pattern;
    for (const param of params) values[param.name] = param.value;
    this.draw(info, this.testTarget, values);
    gl.getError();
    gl.readPixels(0, 0, TEST_W, TEST_H, gl.RGBA, gl.HALF_FLOAT, this.halfPixels);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) return this.testBytes();
    const reason = judge(this.halfPixels);
    if (!reason || reason === "output contains NaN") return reason;
    return this.testBytes() ?? reason;
  }

  private testBytes(): string | null {
    const gl = this.gl;
    if (!gl || !this.byteTarget || !this.copy || !this.tri) return "could not read the test frame";
    const tex = this.testTarget?.attachments[0] as WebGLTexture | undefined;
    if (!tex) return "could not read the test frame";
    twgl.bindFramebufferInfo(gl, this.byteTarget);
    gl.viewport(0, 0, TEST_W, TEST_H);
    gl.useProgram(this.copy?.program ?? null);
    if (this.copy && this.tri) {
      twgl.setBuffersAndAttributes(gl, this.copy, this.tri);
      this.setKnownUniforms(this.copy, { uTex: tex });
      twgl.drawBufferInfo(gl, this.tri);
    }
    gl.readPixels(0, 0, TEST_W, TEST_H, gl.RGBA, gl.UNSIGNED_BYTE, this.bytePixels);
    let max = 0;
    let min = 255;
    for (let i = 0; i < this.bytePixels.length; i += 4) {
      const luma = this.bytePixels[i]! * 0.3 + this.bytePixels[i + 1]! * 0.59 + this.bytePixels[i + 2]! * 0.11;
      max = Math.max(max, luma);
      min = Math.min(min, luma);
    }
    if (max < 4) return "output is solid black";
    if (max - min < 3) return "output is a solid color";
    return null;
  }

  private halfPixels = new Uint16Array(TEST_W * TEST_H * 4);
  private bytePixels = new Uint8Array(TEST_W * TEST_H * 4);
  private byteTarget: twgl.FramebufferInfo | null = null;

  private compile(fragment: string): { info: twgl.ProgramInfo } | { error: string } {
    const gl = this.gl;
    if (!gl) return { error: "WebGL is not ready" };
    let message = "";
    const info = twgl.createProgramInfo(gl, [FULLSCREEN_VS, fragment], (msg) => {
      message = String(msg);
    });
    if (!info) return { error: message || "shader failed to compile" };
    return { info };
  }

  private install(id: string, source: string, info: twgl.ProgramInfo, feedback: boolean): Runtime {
    const existing = this.runtime.get(id);
    if (existing) {
      existing.source = source;
      existing.info = info;
      if (feedback && !existing.back) existing.back = this.makeTarget(COOK_W, COOK_H);
      if (!feedback) existing.back = null;
      return existing;
    }
    const created: Runtime = {
      source,
      info,
      front: this.makeTarget(COOK_W, COOK_H),
      back: feedback ? this.makeTarget(COOK_W, COOK_H) : null,
    };
    this.runtime.set(id, created);
    return created;
  }

  private initResources(): void {
    const gl = this.gl;
    if (!gl) return;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.width = Math.max(COOK_W, THUMB_W);
    canvas.height = Math.max(COOK_H, THUMB_H);
    this.tri = twgl.createBufferInfoFromArrays(gl, {
      aPos: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
    });
    const copy = this.compile(COPY_FS);
    if ("error" in copy) {
      this.fail(copy.error);
      return;
    }
    this.copy = copy.info;
    this.black = twgl.createTexture(gl, {
      width: 1,
      height: 1,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      src: [0, 0, 0, 255],
    });
    const pattern = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        pattern[i] = Math.floor((x / 31) * 255);
        pattern[i + 1] = Math.floor((y / 31) * 255);
        pattern[i + 2] = Math.floor((0.5 + 0.5 * Math.sin(x * 0.7 + y * 0.4)) * 255);
        pattern[i + 3] = 255;
      }
    }
    this.pattern = twgl.createTexture(gl, {
      width: 32,
      height: 32,
      min: gl.LINEAR,
      mag: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
      src: pattern,
    });
    this.audioPixels.fill(0);
    this.audioTex = twgl.createTexture(gl, {
      width: 512,
      height: 2,
      min: gl.LINEAR,
      mag: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
      src: this.audioPixels,
    });
    this.testTarget = this.makeTarget(TEST_W, TEST_H);
    this.byteTarget = twgl.createFramebufferInfo(
      gl,
      [{ format: gl.RGBA, type: gl.UNSIGNED_BYTE, min: gl.NEAREST, mag: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE }],
      TEST_W,
      TEST_H,
    );
  }

  private makeTarget(w: number, h: number): twgl.FramebufferInfo {
    const gl = this.gl;
    if (!gl) throw new Error("no gl");
    const attach = {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
      min: gl.LINEAR,
      mag: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    };
    const fbi = twgl.createFramebufferInfo(gl, [attach], w, h);
    twgl.bindFramebufferInfo(gl, fbi);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      const nearest = twgl.createFramebufferInfo(gl, [{ ...attach, min: gl.NEAREST, mag: gl.NEAREST }], w, h);
      this.clearTarget(nearest);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("float framebuffer is incomplete");
      }
      return nearest;
    }
    this.clearTarget(fbi);
    return fbi;
  }

  private clearTarget(target: twgl.FramebufferInfo): void {
    const gl = this.gl;
    if (!gl) return;
    twgl.bindFramebufferInfo(gl, target);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private fillAudio(): void {
    const gl = this.gl;
    if (!gl || !this.audioTex) return;
    const pixels = this.audioPixels;
    if (this.analyser) {
      this.analyser.getFloatFrequencyData(this.freq);
      this.analyser.getFloatTimeDomainData(this.wave);
      for (let i = 0; i < 512; i++) {
        const spec = Math.min(1, Math.max(0, (this.freq[i]! + 90) / 80));
        const sample = this.wave[i]! * 0.5 + 0.5;
        writeTexel(pixels, i, spec);
        writeTexel(pixels, 512 + i, sample);
      }
    } else {
      for (let i = 0; i < 512; i++) {
        const f = i / 512;
        const spec = Math.pow(Math.max(0, Math.sin(this.time * 2.2 + f * 18) * 0.5 + 0.5), 2) * Math.exp(-f * 1.6);
        const sample = Math.sin(f * 36 + this.time * 5) * 0.5 + 0.5;
        writeTexel(pixels, i, spec);
        writeTexel(pixels, 512 + i, sample);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }

  private ensureDrawingBuffer(w: number, h: number): void {
    const canvas = this.gl?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  private viewerPixels(): { w: number; h: number } {
    const canvas = this.viewer;
    if (!canvas) return { w: 640, h: 360 };
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    return {
      w: Math.max(2, Math.floor(canvas.clientWidth * dpr)),
      h: Math.max(2, Math.floor(canvas.clientHeight * dpr)),
    };
  }

  private setKnownUniforms(info: twgl.ProgramInfo, values: Record<string, unknown>): void {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (info.uniformSetters[key]) filtered[key] = value;
    }
    twgl.setUniforms(info, filtered);
  }

  private track(canvas: HTMLCanvasElement, event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    this.pointer.x = clamp01((event.clientX - rect.left) / Math.max(rect.width, 1));
    this.pointer.y = clamp01(1 - (event.clientY - rect.top) / Math.max(rect.height, 1));
    this.pointer.seen = true;
    this.emitPointer();
  }

  private emitPointer(): void {
    this.onPointer?.({ x: this.pointer.x, y: this.pointer.y, down: this.pointer.down });
  }

  private fail(message: string): void {
    this.failed = message;
    useGraph.getState().setGpuError(message);
  }
}

function writeTexel(pixels: Uint8Array, index: number, value: number): void {
  const byte = Math.max(0, Math.min(255, Math.round(value * 255)));
  const o = index * 4;
  pixels[o] = byte;
  pixels[o + 1] = byte;
  pixels[o + 2] = byte;
  pixels[o + 3] = 255;
}

function cursorArray(list: Cursor[]): Float32Array {
  const cursors = new Float32Array(32);
  list.slice(0, 8).forEach((cursor, i) => {
    cursors[i * 4] = cursor.x;
    cursors[i * 4 + 1] = cursor.y;
    cursors[i * 4 + 2] = cursor.down ? 1 : 0;
  });
  return cursors;
}

function hash(source: string): string {
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${h >>> 0}:${source.length}`;
}

function topo(nodes: PNode[], edges: { source: string; target: string }[]): string[] {
  const ids = nodes.map((node) => node.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const next = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!indeg.has(edge.source) || !indeg.has(edge.target)) continue;
    next.get(edge.source)?.push(edge.target);
    indeg.set(edge.target, (indeg.get(edge.target) ?? 0) + 1);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    order.push(id);
    for (const child of next.get(id) ?? []) {
      const left = (indeg.get(child) ?? 1) - 1;
      indeg.set(child, left);
      if (left === 0) queue.push(child);
    }
  }
  return order.length === ids.length ? order : ids;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function judge(pixels: Uint16Array): string | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = halfToFloat(pixels[i] ?? 0);
    const g = halfToFloat(pixels[i + 1] ?? 0);
    const b = halfToFloat(pixels[i + 2] ?? 0);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return "output contains NaN";
    const luma = r * 0.3 + g * 0.59 + b * 0.11;
    min = Math.min(min, luma);
    max = Math.max(max, luma);
  }
  if (max < 0.02) return "output is solid black";
  if (max - min < 0.012) return "output is a solid color";
  return null;
}

function quantize(h: number): number {
  const value = halfToFloat(h);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function halfToFloat(h: number): number {
  const sign = (h & 0x8000) >> 15;
  const exp = (h & 0x7c00) >> 10;
  const mant = h & 0x03ff;
  if (exp === 0) return (sign ? -1 : 1) * 2 ** -14 * (mant / 1024);
  if (exp === 31) return mant ? Number.NaN : sign ? -Infinity : Infinity;
  return (sign ? -1 : 1) * 2 ** (exp - 15) * (1 + mant / 1024);
}

export const engine = new Engine();
