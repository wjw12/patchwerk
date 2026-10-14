import * as twgl from "twgl.js";
import { CAPTURE_H, CAPTURE_W } from "../capture";
import { cookChop } from "./chop";
import { cookOrder } from "./cook";
import { ExprError, type ExprEnv } from "./expr";
import { camera, orbitCamera } from "./math";
import { PopBank, type PopOut } from "./pop";
import type { Light, PhongLook } from "./mat";
import { COOK_H, COOK_W, freeTarget, ImageOps, OUT_H, OUT_W } from "./render";
import { clearLive } from "./live";
import { resolvePars, type Resolved } from "./resolve";
import { encodeBytes, publish } from "../probe";
import type { Launch } from "../session";
import { useGraph } from "../store";
import type { PNode } from "../store";
import { FULLSCREEN_VS } from "./fullscreen";
import { COPY_FS, PASSTHROUGH } from "./sources";
import { channelSampling, compilerErrors, parseShader, shaderNumberPar, wrapShader, type ParsedShader, type ShaderParam } from "./wrap";
const GPU_TIMEOUT = "GPU timeout / context lost. Running the last good version; edit the shader to try again.";
/** How long after a commit a context loss is still blamed on it. */
const SUSPECT_MS = 10_000;
const TEST_W = 48;
const TEST_H = 48;
const THUMB_W = 160;
const THUMB_H = 90;

export interface Cursor {
  x: number;
  y: number;
  down: boolean;
}

export interface FrameStats {
  mean: number;
  black: number;
  nan: number;
}

export type Snapshot =
  | { kind: "image"; time: number; png: string; stats: FrameStats | null }
  | { kind: "chop"; time: number; now: number | null; history: number[] };

type Picture = { x: number; y: number; w: number; h: number };
type Output = { tex: WebGLTexture; w: number; h: number };

interface Runtime {
  source: string;
  info: twgl.ProgramInfo;
  front: twgl.FramebufferInfo;
  back: twgl.FramebufferInfo | null;
  /** The cook serial this runtime last drew in. Before it draws this frame, front is last frame. */
  cooked: number;
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
  /** The spectrum row of the audio texture as floats, for the audioband CHOP. */
  private spectrum = new Float32Array(512);
  private pointer = { x: 0.5, y: 0.5, down: false, seen: false, clickX: 0, clickY: 0, dragX: 0, dragY: 0, clicked: false, ever: false };
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
  private pops: PopBank | null = null;
  private imageOps: ImageOps | null = null;
  private images = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  private chopNow = new Map<string, number>();
  private chopPrev = new Map<string, number>();
  private chopHist = new Map<string, number[]>();
  private chopDone = new Set<string>();
  private resolved = new Map<string, Resolved>();
  /** How the last render drew its points; POP previews and the orbit viewer draw the same way. */
  private cloudLook: { scale: number; focus: number; alpha: number; phong?: PhongLook; lights?: Light[] } = { scale: 6, focus: 4, alpha: 0.9 };
  private orbit = { yaw: 0.5, pitch: 0.35, dist: 6 };
  private skipAdvance = false;
  /** Counts presented frames. Previews alternate on it, so they keep refreshing while paused. */
  private presented = 0;
  /** A fixed session has published its frame; from then on it re-cooks the same instant on edits. */
  private settled = false;
  private settleRaf = 0;
  private settleCook = false;
  private settledSeen: { edges: unknown; data: Map<string, unknown> } = { edges: null, data: new Map() };
  private floatLinear = false;
  /** Where the last viewer blit put the picture, as fractions of the viewer canvas (y from the top). */
  private picture: Picture | null = null;
  /** Bumped once per cook; see Runtime.cooked. */
  private cookSerial = 0;
  private prevWanted = new Set<string>();
  private parsed = new Map<string, ParsedShader>();
  /** Per-input samplers by "filter/wrap"; RGBA32F targets; the cook each texture was last mipped in. */
  private samplers = new Map<string, WebGLSampler>();
  private fullTextures = new WeakSet<WebGLTexture>();
  private mipped = new WeakMap<WebGLTexture, number>();
  /** The newest commit, until it has run long enough to be trusted. */
  private suspect: { id: string; source: string; good: string | null; at: number } | null = null;
  /** Hashes of shader sources that lost the context. Survives restore and stop(). */
  private poisoned = new Set<string>();
  private afterCook: (() => void)[] = [];
  private snapCanvas: HTMLCanvasElement | null = null;
  private statPixels: Float32Array | null = null;
  private statFbo: WebGLFramebuffer | null = null;

  get seconds(): number {
    return this.time;
  }

  compileNow(id: string): { status: "live" | "error"; error: string | null } {
    const timer = this.timers.get(id);
    if (timer) window.clearTimeout(timer);
    this.timers.delete(id);
    const node = useGraph.getState().nodes.find((item) => item.id === id);
    if (!node || node.data.kind !== "shader") return { status: "error", error: "not a shader TOP" };
    this.drafts.set(id, node.data.draft);
    this.tryCommit(id);
    const after = useGraph.getState().nodes.find((item) => item.id === id);
    if (!after || after.data.kind !== "shader") return { status: "error", error: "the node is gone" };
    if (after.data.status === "live") return { status: "live", error: null };
    return { status: "error", error: after.data.error ?? this.failed ?? "the GPU is not ready" };
  }

  snapshot(id: string, w: number, h: number): Promise<Snapshot> {
    if (document.hidden) return Promise.reject(new Error("the asking tab is in the background; frames are not cooking; ask the human to bring it to the front"));
    if (!this.gl) return Promise.reject(new Error("WebGL is not running in the asking tab"));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.afterCook = this.afterCook.filter((item) => item !== paint);
        reject(new Error(this.failed || "no frame cooked within 2 s"));
      }, 2000);
      const paint = () => {
        window.clearTimeout(timer);
        try {
          resolve(this.paintSnapshot(id, w, h));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      this.afterCook.push(paint);
    });
  }

  private paintSnapshot(id: string, w: number, h: number): Snapshot {
    const nodes = useGraph.getState().nodes;
    const node = nodes.find((item) => item.id === id);
    if (!node) throw new Error("the node is gone");
    if (node.data.family === "CHOP") {
      return { kind: "chop", time: this.time, now: this.chopNow.get(id) ?? null, history: [...(this.chopHist.get(id) ?? [])] };
    }
    const gl = this.gl;
    const host = gl?.canvas as HTMLCanvasElement | undefined;
    if (!gl || !host) throw new Error("WebGL is not running in the asking tab");
    const canvas = (this.snapCanvas ??= document.createElement("canvas"));
    fitCanvas(canvas, { w, h });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context for the snapshot");
    fitCanvas(host, { w: Math.max(host.width, w), h: Math.max(host.height, h) });
    const output = this.paintInto(node, nodes, canvas, ctx, { w, h }, "snapshot");
    const stats = output ? this.measure(output) : null;
    return { kind: "image", time: this.time, png: canvas.toDataURL("image/png").split(",")[1] ?? "", stats };
  }

  private measure(output: Output): FrameStats | null {
    const gl = this.gl;
    if (!gl) return null;
    const fbo = (this.statFbo ??= gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output.tex, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    const count = output.w * output.h * 4;
    if (!this.statPixels || this.statPixels.length < count) this.statPixels = new Float32Array(count);
    let error: number = gl.NO_ERROR;
    if (complete) {
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      gl.getError();
      gl.readPixels(0, 0, output.w, output.h, gl.RGBA, gl.FLOAT, this.statPixels);
      error = gl.getError();
    }
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete || error !== gl.NO_ERROR) return null;
    const pixels = output.w * output.h;
    let sum = 0;
    let black = 0;
    let nan = 0;
    const data = this.statPixels;
    for (let i = 0; i < count; i += 4) {
      const luma = data[i]! * 0.3 + data[i + 1]! * 0.59 + data[i + 2]! * 0.11;
      if (Number.isNaN(luma)) {
        nan += 1;
        continue;
      }
      sum += clamp01(luma);
      if (luma < 2 / 255) black += 1;
    }
    return { mean: sum / pixels, black: black / pixels, nan };
  }

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
    if (!gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)) {
      this.failFixed("MAX_VERTEX_TEXTURE_IMAGE_UNITS is 0. The point MAT needs vertex texture fetch.");
      return;
    }
    this.floatLinear = gl.getExtension("OES_texture_float_linear") != null;
    this.gl = gl;
    const signal = this.abort.signal;
    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        const blamed = this.blameLoss();
        this.failed = blamed
          ? `WebGL context lost, likely a GPU timeout in ${blamed}. Restoring the last good shaders.`
          : "WebGL context lost. Restoring the last good shaders.";
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
        this.images.clear();
        this.samplers.clear();
        try {
          // Extensions are per context; a restored context starts without them.
          if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is missing after restore");
          this.floatLinear = gl.getExtension("OES_texture_float_linear") != null;
          this.initResources();
          this.booting = true;
          this.watchDrafts(useGraph.getState().nodes);
          this.booting = false;
          // Re-committing ran-before drafts is not new evidence; only fresh edits are suspects.
          this.suspect = null;
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
      if (this.skipAdvance) this.skipAdvance = false;
      else if (useGraph.getState().playing) {
        this.time += dt;
        this.frame += 1;
      }
      this.frameMs += (dt * 1000 - this.frameMs) * 0.2;
      const clock = document.getElementById("abs-time");
      if (clock) clock.textContent = `absTime  ${this.time.toFixed(2)} s`;
      const stats = document.getElementById("stats");
      if (stats) stats.textContent = `${this.frameMs > 0.05 ? (1000 / this.frameMs).toFixed(0) : "—"} fps`;
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
    this.settled = false;
    if (this.settleRaf) cancelAnimationFrame(this.settleRaf);
    this.settleRaf = 0;
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
    this.samplers.clear();
    this.copy = null;
    this.tri = null;
    this.pops = null;
    this.imageOps = null;
    this.images.clear();
  }

  invalidate(): void {
    this.drafts.clear();
    if (this.gl) this.watchDrafts(useGraph.getState().nodes);
  }

  /** Playbar reset. The next presented frame cooks at t = 0. Fixed ?t=&frame= sessions do not call this. */
  resetClock(): void {
    this.time = 0;
    this.frame = 0;
    this.chopHist.clear();
    this.skipAdvance = true;
    const clock = document.getElementById("abs-time");
    if (clock) clock.textContent = "absTime  0.00 s";
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
    this.pointer.ever = false;
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
    this.settled = true;
    this.noteFixedGraph();
    this.refreshFixed(false);
  }

  /**
   * After the probe is published, a fixed session stays at its instant. Previews that mount
   * late get the cooked images; edits to parameters, wires or shaders cook that instant again.
   */
  private refreshFixed(cook: boolean): void {
    if (!this.launch.fixed || !this.settled) return;
    this.settleCook ||= cook;
    if (this.settleRaf) return;
    this.settleRaf = requestAnimationFrame(() => {
      this.settleRaf = 0;
      const recook = this.settleCook;
      this.settleCook = false;
      if (!this.settled) return;
      this.present = true;
      try {
        if (recook) this.cook();
        else this.presentAll(useGraph.getState().nodes);
      } catch (error) {
        this.failed = error instanceof Error ? error.message : "cook failed";
      }
    });
  }

  /** True when node data or wires changed since the last call (not just position, size or selection). */
  private noteFixedGraph(): boolean {
    const { nodes, edges } = useGraph.getState();
    const seen = this.settledSeen;
    const changed =
      edges !== seen.edges || nodes.length !== seen.data.size || nodes.some((node) => seen.data.get(node.id) !== node.data);
    this.settledSeen = { edges, data: new Map(nodes.map((node) => [node.id, node.data])) };
    return changed;
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
    // Goldens are cook pixels. out draws at 1080p, so run its pass once more at the cook size.
    let target = runtime.front;
    const redraw = target.width !== COOK_W || target.height !== COOK_H;
    if (redraw) {
      const { nodes, edges } = useGraph.getState();
      const node = nodes.find((item) => item.id === viewerId);
      if (!node) throw new Error(`no node ${viewerId}`);
      target = this.makeTarget(COOK_W, COOK_H);
      this.draw(runtime.info, target, this.uniformsFor(node, this.parseCached(runtime.source).params, false, target, edges, nodes));
    }
    twgl.bindFramebufferInfo(gl, target);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    // RGBA/FLOAT is the readback every float color buffer guarantees, RGBA16F or RGBA32F (feedback).
    const raw = new Float32Array(CAPTURE_W * CAPTURE_H * 4);
    gl.getError();
    gl.readPixels(x, y, CAPTURE_W, CAPTURE_H, gl.RGBA, gl.FLOAT, raw);
    const error = gl.getError();
    if (redraw) freeTarget(gl, target);
    if (error !== gl.NO_ERROR) {
      throw new Error(`FLOAT readPixels failed (gl ${error}). Float readback is required; not falling back to RGBA8.`);
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
    this.refreshFixed(false);
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
    // A fixed session draws once, so fullscreen or a panel resize has to ask for the picture again.
    new ResizeObserver(() => this.refreshFixed(false)).observe(canvas);
    canvas.addEventListener("pointerdown", (event) => {
      this.pointer.down = true;
      this.track(canvas, event);
      this.pointer.clickX = this.pointer.x;
      this.pointer.clickY = this.pointer.y;
      this.pointer.clicked = true;
      this.pointer.ever = true;
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
    canvas.addEventListener("pointermove", (event) => {
      if (this.pointer.down && this.orbitingNow()) {
        this.orbit.yaw += event.movementX * 0.01;
        this.orbit.pitch = Math.max(-1.2, Math.min(1.2, this.orbit.pitch - event.movementY * 0.01));
      }
      this.track(canvas, event);
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.orbitingNow()) return;
        event.preventDefault();
        this.orbit.dist = Math.min(40, Math.max(0.4, this.orbit.dist * (event.deltaY > 0 ? 1.08 : 0.92)));
      },
      { passive: false },
    );
  }

  /** What the viewer shows, drawn again at 1080p and encoded as a PNG. The viewer's save button. */
  saveFrame(): Promise<Blob | null> {
    const gl = this.gl;
    const canvas = gl?.canvas as HTMLCanvasElement | undefined;
    const nodes = useGraph.getState().nodes;
    const node = nodes.find((item) => item.selected) ?? nodes.find((item) => item.id === "out");
    if (!gl || gl.isContextLost() || !canvas || !node) return Promise.resolve(null);
    const size = { w: OUT_W, h: OUT_H };
    const out = document.createElement("canvas");
    const ctx = out.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    // The hidden canvas keeps no buffer between frames, so this draws and copies out in one task.
    // The next presented frame sizes it back to the viewer.
    fitCanvas(canvas, { w: Math.max(canvas.width, size.w), h: Math.max(canvas.height, size.h) });
    this.paintInto(node, nodes, out, ctx, size, "snapshot");
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  /** What the audio texture reads (src/audio.ts owns the mic or file behind it); null is the built-in test signal. */
  setAnalyser(analyser: AnalyserNode | null): void {
    this.analyser = analyser;
  }

  private boot(): void {
    this.booting = true;
    const unsub = useGraph.subscribe((state) => {
      this.watchDrafts(state.nodes);
      if (this.settled) this.refreshFixed(this.noteFixedGraph());
    });
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
    // A lost context compiles nothing; the restore re-commits every draft.
    if (!gl || gl.isContextLost()) return;
    const node = useGraph.getState().nodes.find((item) => item.id === id);
    if (!node || node.data.kind !== "shader") return;
    if (this.poisoned.has(hash(node.data.draft))) {
      useGraph.getState().applyCompile(id, { status: "error", error: GPU_TIMEOUT });
      return;
    }
    const parsed = parseShader(node.data.draft);
    const wrapped = wrapShader(node.data.draft);
    const compiled = this.compile(wrapped.source);
    if ("error" in compiled) {
      useGraph.getState().applyCompile(id, {
        status: "error",
        error: compilerErrors(compiled.error, wrapped.userLines),
      });
      return;
    }
    // Loops are not bounded statically. If this program hangs the GPU, the driver resets the
    // context and the loss is pinned on the newest commit (see blameLoss).
    const before = this.suspect;
    this.suspect = { id, source: node.data.draft, good: node.data.committed, at: performance.now() };
    const bad = this.testOutput(compiled.info, parsed.params);
    if (gl.isContextLost()) return;
    if (bad) {
      this.suspect = before;
      gl.deleteProgram(compiled.info.program);
      useGraph.getState().applyCompile(id, { status: "error", error: bad });
      return;
    }
    this.programs.set(hash(wrapped.source), compiled.info);
    this.install(id, node.data.draft, compiled.info, parsed.feedback, { w: COOK_W, h: COOK_H });
    useGraph.getState().applyCompile(id, { status: "live", error: null, committed: node.data.draft });
    this.sweepPrograms(useGraph.getState().nodes);
  }

  private cook(): void {
    const gl = this.gl;
    const canvas = gl?.canvas as HTMLCanvasElement | undefined;
    if (!gl || gl.isContextLost() || !canvas || !this.tri || !this.copy || !this.black) return;
    const { nodes, edges } = useGraph.getState();
    if (nodes !== this.prunedFor) this.prune(nodes);
    this.fillAudio();
    this.cookOps(nodes, edges);
    this.pointer.clicked = false;
    if (this.present) this.presentAll(nodes);
    if (this.afterCook.length) {
      const waiting = this.afterCook;
      this.afterCook = [];
      for (const paint of waiting) paint();
    }
    const hud = document.getElementById("hud");
    if (hud) {
      const fresh = useGraph.getState().nodes;
      const live = fresh.filter((node) => (node.data.kind !== "shader" && node.data.kind !== "op") || node.data.status === "live").length;
      hud.textContent = this.failed || `${live}/${fresh.length} live · ${COOK_W}×${COOK_H} · ${this.frame}`;
    }
  }

  /** Copies cooked outputs into node previews and the viewer. Does not cook. */
  private presentAll(nodes: PNode[]): void {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    const selected = nodes.find((node) => node.selected) ?? nodes.find((node) => node.id === "out");
    this.presented += 1;
    this.ensureDrawingBuffer();
    if ((this.presented & 1) === 0 || this.launch.fixed) this.blitPreviews(nodes);
    this.drawChopPreviews(nodes);
    this.drawPopPreviews(nodes);
    if (selected && this.viewer && this.viewerCtx) this.presentViewer(selected, nodes);
  }

  private prunedFor: PNode[] | null = null;
  /** absTime of the previous cook, and whether this cook moved past it. */
  private cookedAt = Number.NaN;
  private advanced = true;

  /** Deleted nodes give back their GPU targets, programs and per-node maps. */
  private prune(nodes: PNode[]): void {
    this.prunedFor = nodes;
    const alive = new Set(nodes.map((node) => node.id));
    let dropped = false;
    for (const [id, rt] of [...this.runtime]) {
      if (alive.has(id)) continue;
      this.freeRuntime(rt);
      this.runtime.delete(id);
      dropped = true;
    }
    for (const id of [...this.images.keys()]) {
      if (!alive.has(id)) this.images.delete(id);
    }
    this.imageOps?.prune(alive);
    this.pops?.prune(new Set([...alive, "__unit__"]));
    for (const map of [this.chopNow, this.chopPrev, this.chopHist, this.resolved, this.drafts]) {
      for (const id of [...map.keys()]) {
        if (alive.has(id)) continue;
        map.delete(id);
        clearLive(id);
      }
    }
    for (const [id, timer] of [...this.timers]) {
      if (alive.has(id)) continue;
      window.clearTimeout(timer);
      this.timers.delete(id);
    }
    if (dropped) this.sweepPrograms(nodes);
  }

  private freeRuntime(rt: Runtime): void {
    const gl = this.gl;
    if (!gl) return;
    freeTarget(gl, rt.front);
    if (rt.back) freeTarget(gl, rt.back);
  }

  /** Deletes compiled programs that no runtime and no committed shader still uses. */
  private sweepPrograms(nodes: PNode[]): void {
    const gl = this.gl;
    if (!gl) return;
    const keep = new Set<string>([hash(wrapShader(PASSTHROUGH).source)]);
    for (const node of nodes) {
      if (node.data.kind === "shader" && node.data.committed) keep.add(hash(wrapShader(node.data.committed).source));
    }
    const used = new Set([...this.runtime.values()].map((rt) => rt.info.program));
    for (const [key, info] of [...this.programs]) {
      if (keep.has(key) || used.has(info.program)) continue;
      gl.deleteProgram(info.program);
      this.programs.delete(key);
    }
  }

  private cookOps(nodes: PNode[], edges: { source: string; target: string; targetHandle?: string | null }[]): void {
    this.chopPrev = new Map(this.chopNow);
    this.chopDone = new Set();
    this.advanced = this.time !== this.cookedAt;
    this.cookedAt = this.time;
    this.cookSerial += 1;
    this.prevWanted = this.prevTargets(nodes);
    const order = cookOrder(
      nodes.map((node) => node.id),
      (id) => nodes.find((node) => node.id === id)?.data.family ?? "TOP",
      edges,
    );
    for (const id of order) {
      const node = nodes.find((item) => item.id === id);
      if (!node || node.data.kind === "audio") continue;
      if (node.data.kind === "shader" || node.data.kind === "out") {
        this.cookShader(node, nodes, edges);
        continue;
      }
      if (node.data.kind !== "op") continue;
      const resolved = resolvePars(node.id, node.data.pars, this.exprEnv(nodes));
      this.resolved.set(node.id, resolved);
      const parError = resolved.errors.map((item) => `${item.name}: ${item.error}`).join("\n");
      let cookError: string | null = null;
      if (node.data.family === "CHOP") cookError = this.cookChopNode(node, nodes, edges, resolved);
      else if (node.data.family === "POP") cookError = this.cookPopNode(node, nodes, edges, resolved);
      else if (node.data.type === "render") cookError = this.cookRenderNode(node, nodes, resolved);
      else if (node.data.type === "bloom") cookError = this.cookBloomNode(node, nodes, edges, resolved);
      // A TOP that cannot cook shows black, not its last good image.
      if (cookError && node.data.family === "TOP" && this.imageOps) this.images.set(node.id, this.imageOps.blank(node.id));
      const error = [parError, cookError].filter((item) => item).join("\n") || null;
      this.note(node, error);
    }
  }

  private cookShader(
    node: PNode,
    nodes: PNode[],
    edges: { source: string; target: string; targetHandle?: string | null }[],
  ): void {
    const bypass = node.data.kind === "shader" && node.data.bypass;
    const source = node.data.kind === "out" || bypass ? PASSTHROUGH : node.data.kind === "shader" ? node.data.committed : null;
    if (!source || this.poisoned.has(hash(source))) return;
    const parsed = this.parseCached(source);
    const wrapped = wrapShader(source);
    let info = this.programs.get(hash(wrapped.source));
    if (!info) {
      const compiled = this.compile(wrapped.source);
      if ("error" in compiled) return;
      info = compiled.info;
      this.programs.set(hash(wrapped.source), info);
    }
    const feedback = node.data.kind === "shader" && !bypass && parsed.feedback;
    const prev = node.data.kind === "shader" && !bypass ? parsed.prev : [];
    const size = node.data.kind === "out" ? { w: OUT_W, h: OUT_H } : { w: COOK_W, h: COOK_H };
    const rt = this.install(node.id, source, info, feedback || this.prevWanted.has(node.id), size);
    const target = rt.back ?? rt.front;
    const previous = rt.front;
    this.draw(info, target, this.uniformsFor(node, parsed.params, feedback, previous, edges, nodes, prev));
    if (rt.back) {
      rt.front = rt.back;
      rt.back = previous;
    }
    rt.cooked = this.cookSerial;
  }

  private parseCached(source: string): ParsedShader {
    let parsed = this.parsed.get(source);
    if (!parsed) {
      if (this.parsed.size > 64) this.parsed.clear();
      parsed = parseShader(source);
      this.parsed.set(source, parsed);
    }
    return parsed;
  }

  /** Shader TOPs some `// @prev` reads. They keep last frame in a second buffer. */
  private prevTargets(nodes: PNode[]): Set<string> {
    const wanted = new Set<string>();
    for (const node of nodes) {
      if (node.data.kind !== "shader" || node.data.bypass || !node.data.committed) continue;
      for (const item of this.parseCached(node.data.committed).prev) {
        const id = item.label === "self" ? node.id : this.byLabel(nodes, item.label)?.id;
        if (id) wanted.add(id);
      }
    }
    return wanted;
  }

  /** What `@prev` binds: the named TOP's frame from before this cook. */
  private previousFrame(self: PNode, label: string, nodes: PNode[]): { tex: WebGLTexture; w: number; h: number } | null {
    const node = label === "self" ? self : this.byLabel(nodes, label);
    if (!node) return null;
    const rt = this.runtime.get(node.id);
    // Not a shader TOP (render, bloom, audio): there is no second buffer, so it reads the current image.
    if (!rt) return this.outputTexture(node);
    const last = rt.back && rt.cooked === this.cookSerial ? rt.back : rt.front;
    return { tex: last.attachments[0] as WebGLTexture, w: last.width, h: last.height };
  }

  private cookChopNode(
    node: PNode,
    nodes: PNode[],
    edges: { source: string; target: string; targetHandle?: string | null }[],
    resolved: Resolved,
  ): string | null {
    if (node.data.kind !== "op") return null;
    const a = this.chopSample(this.wired(edges, nodes, node.id, "in0"));
    const b = this.chopSample(this.wired(edges, nodes, node.id, "in1"));
    let sample = 0;
    let error: string | null = null;
    if (node.data.bypass) sample = a ?? b ?? 0;
    else {
      try {
        sample = cookChop(node.data.type, resolved.num, resolved.menu, { a, b, spectrum: this.spectrum }, this.time);
      } catch (err) {
        error = err instanceof Error ? err.message : "chop failed";
      }
    }
    this.chopNow.set(node.id, sample);
    this.chopDone.add(node.id);
    const ring = this.chopHist.get(node.id) ?? [];
    // Paused, time did not move: refresh the newest sample instead of growing a flat line.
    if (this.advanced || ring.length === 0) ring.push(sample);
    else ring[ring.length - 1] = sample;
    if (ring.length > 120) ring.shift();
    this.chopHist.set(node.id, ring);
    return error;
  }

  private cookPopNode(
    node: PNode,
    nodes: PNode[],
    edges: { source: string; target: string; targetHandle?: string | null }[],
    resolved: Resolved,
  ): string | null {
    if (!this.pops || node.data.kind !== "op") return "POP cook is not ready";
    const input0 = this.popOut(this.wired(edges, nodes, node.id, "in0"));
    const input1 = this.popOut(this.wired(edges, nodes, node.id, "in1"));
    return this.pops.cook(node.id, {
      type: node.data.type,
      bypass: node.data.bypass,
      num: resolved.num,
      menu: resolved.menu,
      text: resolved.text,
      input0,
      input1,
    });
  }

  private cookRenderNode(node: PNode, nodes: PNode[], resolved: Resolved): string | null {
    if (!this.imageOps || node.data.kind !== "op") return "render is not ready";
    if (node.data.bypass) {
      this.images.set(node.id, this.imageOps.render(node.id, null));
      return null;
    }
    const geo = this.byLabel(nodes, resolved.text.geo ?? "");
    if (!geo || geo.data.kind !== "op" || geo.data.type !== "geo") return `geo "${resolved.text.geo ?? ""}" is missing`;
    const geoResolved = this.resolved.get(geo.id);
    const pop = this.byLabel(nodes, geoResolved?.text.pop ?? "");
    const mat = this.byLabel(nodes, geoResolved?.text.mat ?? "");
    const cam = this.byLabel(nodes, geoResolved?.text.cam ?? "");
    if (!pop || pop.data.kind !== "op" || pop.data.family !== "POP") return "geo pop is missing";
    const cloud = this.pops?.get(pop.id);
    const position = cloud?.attrs.get("P");
    if (!cloud || !position) return "geo pop has no P";
    const matResolved = mat?.data.kind === "op" ? this.resolved.get(mat.id) : undefined;
    const camResolved = cam?.data.kind === "op" ? this.resolved.get(cam.id) : undefined;
    const scale = matResolved?.num.scale ?? 6;
    const focus = matResolved?.num.focus ?? 4;
    const alpha = matResolved?.num.alpha ?? 0.9;
    const color: [number, number, number] = [matResolved?.num.colorr ?? 1, matResolved?.num.colorg ?? 1, matResolved?.num.colorb ?? 1];
    const phong = mat?.data.kind === "op" && mat.data.type === "phong" ? phongLook(matResolved?.num ?? {}) : undefined;
    const lights = phong ? this.lightsFor(nodes, resolved.text.lights ?? "*") : undefined;
    this.cloudLook = { scale, focus, alpha, phong, lights };
    const camNum = camResolved?.num;
    const mats = camera(camNum?.tx ?? 0, camNum?.ty ?? 0, camNum?.tz ?? 5, camNum?.fov ?? 45, COOK_W / COOK_H, [camNum?.lookx ?? 0, camNum?.looky ?? 0, camNum?.lookz ?? 0]);
    this.images.set(node.id, this.imageOps.render(node.id, { p: position, n: cloud.n, ...mats, scale, focus, alpha, color, phong, lights }));
    return null;
  }

  private cookBloomNode(
    node: PNode,
    nodes: PNode[],
    edges: { source: string; target: string; targetHandle?: string | null }[],
    resolved: Resolved,
  ): string | null {
    if (!this.imageOps || node.data.kind !== "op") return "bloom is not ready";
    const input = this.wired(edges, nodes, node.id, "in0");
    const image = input ? this.outputTexture(input) : null;
    if (!image) return "bloom has no input";
    if (node.data.bypass) {
      this.images.set(node.id, this.imageOps.copyImage(node.id, image.tex));
      return null;
    }
    this.images.set(
      node.id,
      this.imageOps.bloomPass(node.id, image.tex, image.w, image.h, {
        threshold: resolved.num.threshold ?? 0.01,
        fill: resolved.num.fill ?? 0.72,
        intensity: resolved.num.intensity ?? 1.24,
        pregamma: resolved.num.pregamma ?? 1.5,
      }),
    );
    return null;
  }

  private exprEnv(nodes: PNode[]): ExprEnv {
    return {
      seconds: this.time,
      op: (name, channel) => {
        if (channel !== "chan1") throw new ExprError(`['${channel}'] is not cooked`);
        const found = nodes.find((node) => node.data.label === name);
        if (!found) throw new ExprError(`op('${name}') is missing`);
        if (found.data.kind !== "op" || found.data.family !== "CHOP") throw new ExprError(`op('${name}') is not a CHOP`);
        if (this.chopDone.has(found.id)) {
          const value = this.chopNow.get(found.id);
          if (value != null) return value;
        }
        const prev = this.chopPrev.get(found.id);
        if (prev != null) return prev;
        throw new ExprError(`op('${name}') has no chan1 yet`);
      },
    };
  }

  private note(node: PNode, error: string | null): void {
    if (node.data.kind !== "op") return;
    const status = error ? "error" : "live";
    if (node.data.status === status && node.data.error === error) return;
    useGraph.getState().setCookStatus(node.id, status, error);
  }

  private wired(
    edges: { source: string; target: string; targetHandle?: string | null }[],
    nodes: PNode[],
    id: string,
    handle: string,
  ): PNode | undefined {
    const edge = edges.find((item) => item.target === id && item.targetHandle === handle);
    if (!edge) return undefined;
    return nodes.find((node) => node.id === edge.source);
  }

  private chopSample(node: PNode | undefined): number | null {
    if (!node || node.data.kind !== "op" || node.data.family !== "CHOP") return null;
    return this.chopNow.get(node.id) ?? null;
  }

  private popOut(node: PNode | undefined): PopOut | null {
    if (!node) return null;
    return this.pops?.get(node.id) ?? null;
  }

  /** The light COMPs a render's `lights` pattern names: `*`, labels, or globs, separated by spaces. */
  private lightsFor(nodes: PNode[], pattern: string): Light[] {
    return nodes.filter((node) => isLight(node) && matchesPattern(pattern, node.data.label)).map((node) => this.light(node));
  }

  private light(node: PNode): Light {
    const resolved = this.resolved.get(node.id);
    const num = resolved?.num ?? {};
    const dimmer = num.dimmer ?? 1;
    const kind = resolved?.menu.lighttype;
    return {
      kind: kind === "distant" || kind === "cone" || kind === "ambient" ? kind : "point",
      pos: [num.tx ?? 3, num.ty ?? 4, num.tz ?? 5],
      look: [num.lookx ?? 0, num.looky ?? 0, num.lookz ?? 0],
      color: [(num.colorr ?? 1) * dimmer, (num.colorg ?? 1) * dimmer, (num.colorb ?? 1) * dimmer],
      coneangle: num.coneangle ?? 45,
      conedelta: num.conedelta ?? 10,
    };
  }

  private byLabel(nodes: PNode[], label: string): PNode | undefined {
    if (!label) return undefined;
    return nodes.find((node) => node.data.label === label);
  }

  private drawChopPreviews(nodes: PNode[]): void {
    for (const node of nodes) {
      if (node.data.family !== "CHOP") continue;
      const ctx = this.previews.get(node.id);
      if (!ctx) continue;
      this.stroke(ctx, this.chopHist.get(node.id) ?? [], "#3dcf8a");
    }
  }

  private drawPopPreviews(nodes: PNode[]): void {
    for (const node of nodes) {
      if (node.data.kind !== "op" || node.data.family !== "POP") continue;
      const ctx = this.previews.get(node.id);
      const pop = this.pops?.get(node.id);
      const position = pop?.attrs.get("P");
      if (!ctx || !pop || !position || !this.imageOps) continue;
      if ((this.presented & 1) !== 0 && !node.selected && !this.launch.fixed) continue;
      const mats = orbitCamera(0.6, 0.35, 5, 45, 16 / 9);
      const tex = this.imageOps.preview(
        "thumb",
        { p: position, n: pop.n, ...mats, ...this.cloudLook },
        160,
        90,
      );
      this.blitToContext(ctx, tex, 160, 90);
    }
  }

  private presentViewer(node: PNode, nodes: PNode[]): void {
    const dest = this.viewer;
    const ctx = this.viewerCtx;
    if (!dest || !ctx) return;
    this.picture = null;
    this.paintInto(node, nodes, dest, ctx, this.viewerPixels(), "viewer");
  }

  private paintInto(
    node: PNode,
    nodes: PNode[],
    dest: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    size: { w: number; h: number },
    slot: "viewer" | "snapshot",
  ): Output | null {
    if (node.data.family === "CHOP") {
      this.paintScope(dest, ctx, this.chopHist.get(node.id) ?? [], size);
      return null;
    }
    if (node.data.family === "POP" && node.data.kind === "op") {
      this.paintPoints(dest, ctx, node.id, size, slot);
      return null;
    }
    if (node.data.kind === "op" && (node.data.type === "point" || node.data.type === "phong")) {
      const phong = node.data.type === "phong" ? phongLook(this.resolved.get(node.id)?.num ?? {}) : undefined;
      this.paintPoints(dest, ctx, this.popForMat(node, nodes) ?? this.unitPop(), size, slot, { phong, lights: phong && this.lightsFor(nodes, this.lightsForMat(node, nodes)) });
      return null;
    }
    if (node.data.kind === "op" && node.data.type === "light") {
      const image = this.renderFor(node, nodes);
      if (image && this.outputTexture(image)) return this.blitImage(image, dest, ctx, size);
      // Full ambient response, so an ambient light previews as what it adds and not as black.
      this.paintPoints(dest, ctx, this.unitPop(), size, slot, { phong: phongLook({ ambr: 1, ambg: 1, ambb: 1 }), lights: [this.light(node)] });
      return null;
    }
    if (node.data.kind === "op" && (node.data.type === "cam" || node.data.type === "geo")) {
      const image = this.renderFor(node, nodes);
      if (image && this.outputTexture(image)) return this.blitImage(image, dest, ctx, size);
      const pop =
        node.data.type === "geo"
          ? this.popId(nodes, this.resolved.get(node.id)?.text.pop ?? "")
          : this.popForCam(node, nodes);
      this.paintPoints(dest, ctx, pop ?? this.unitPop(), size, slot);
      return null;
    }
    if (this.outputTexture(node)) return this.blitImage(node, dest, ctx, size);
    return null;
  }

  private paintScope(dest: HTMLCanvasElement, ctx: CanvasRenderingContext2D, samples: number[], size: { w: number; h: number }): void {
    fitCanvas(dest, size);
    this.stroke(ctx, samples, "#3dcf8a");
  }

  private paintPoints(
    dest: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    popId: string | null,
    size: { w: number; h: number },
    slot: "viewer" | "snapshot",
    /** Overrides the last render's look: a MAT or light previews itself. */
    look?: { phong: PhongLook | undefined; lights: Light[] | undefined },
  ): void {
    fitCanvas(dest, size);
    const pop = popId ? this.pops?.get(popId) : undefined;
    const position = pop?.attrs.get("P");
    if (!pop || !position || !this.imageOps) {
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, dest.width, dest.height);
      return;
    }
    const mats = orbitCamera(this.orbit.yaw, this.orbit.pitch, this.orbit.dist, 45, size.w / Math.max(size.h, 1));
    const tex = this.imageOps.preview(
      slot,
      { p: position, n: pop.n, ...mats, ...this.cloudLook, ...look },
      size.w,
      size.h,
    );
    this.blitToContext(ctx, tex, size.w, size.h);
  }

  private blitToContext(ctx: CanvasRenderingContext2D, tex: WebGLTexture, w: number, h: number): void {
    const gl = this.gl;
    const canvas = gl?.canvas as HTMLCanvasElement | undefined;
    if (!gl || !canvas) return;
    this.blitTexture(tex, w, h);
    ctx.drawImage(canvas, 0, gl.drawingBufferHeight - h, w, h, 0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  private stroke(ctx: CanvasRenderingContext2D, samples: number[], color: string): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);
    if (samples.length < 2) return;
    let min = -1;
    let max = 1;
    for (const sample of samples) {
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    const span = max - min || 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = (index / (samples.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((sample - min) / span) * (h - 4);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  private popForMat(mat: PNode, nodes: PNode[]): string | null {
    const geo = nodes.find((node) => {
      if (node.data.kind !== "op" || node.data.type !== "geo") return false;
      return this.resolved.get(node.id)?.text.mat === mat.data.label;
    });
    if (!geo) return null;
    return this.popId(nodes, this.resolved.get(geo.id)?.text.pop ?? "");
  }

  /** The lights pattern of the render that draws this MAT, so its preview is lit the same way. */
  private lightsForMat(mat: PNode, nodes: PNode[]): string {
    const geo = nodes.find((node) => node.data.kind === "op" && node.data.type === "geo" && this.resolved.get(node.id)?.text.mat === mat.data.label);
    const render = geo && nodes.find((node) => node.data.kind === "op" && node.data.type === "render" && this.resolved.get(node.id)?.text.geo === geo.data.label);
    return (render && this.resolved.get(render.id)?.text.lights) ?? "*";
  }

  private popForCam(cam: PNode, nodes: PNode[]): string | null {
    const geo = nodes.find((node) => {
      if (node.data.kind !== "op" || node.data.type !== "geo") return false;
      return this.resolved.get(node.id)?.text.cam === cam.data.label;
    });
    if (!geo) return null;
    return this.popId(nodes, this.resolved.get(geo.id)?.text.pop ?? "");
  }

  private popId(nodes: PNode[], label: string): string | null {
    const node = this.byLabel(nodes, label);
    if (!node || node.data.kind !== "op" || node.data.family !== "POP") return null;
    return node.id;
  }

  private renderFor(node: PNode, nodes: PNode[]): PNode | undefined {
    return nodes.find((item) => {
      if (item.data.kind !== "op" || item.data.type !== "render") return false;
      if (node.data.kind === "op" && node.data.type === "light") return matchesPattern(this.resolved.get(item.id)?.text.lights ?? "*", node.data.label);
      const geo = this.byLabel(nodes, this.resolved.get(item.id)?.text.geo ?? "");
      if (!geo || geo.data.kind !== "op" || geo.data.type !== "geo") return false;
      if (node.data.type === "geo") return geo.id === node.id;
      return this.resolved.get(geo.id)?.text.cam === node.data.label;
    });
  }

  private unitPop(): string | null {
    if (!this.pops) return null;
    if (!this.pops.get("__unit__")) {
      this.pops.cook("__unit__", {
        type: "pointgen",
        bypass: false,
        num: { n: 64, s: 0.5 },
        menu: { shape: "circle" },
        text: {},
        input0: null,
        input1: null,
      });
    }
    return this.pops.get("__unit__") ? "__unit__" : null;
  }

  private orbitingNow(): boolean {
    const node = useGraph.getState().nodes.find((item) => item.selected);
    if (!node) return false;
    if (node.data.family === "POP") return true;
    return node.data.kind === "op" && (node.data.type === "point" || node.data.type === "phong" || node.data.type === "light" || node.data.type === "geo" || node.data.type === "cam");
  }

  private uniformsFor(
    node: PNode,
    params: ShaderParam[],
    feedback: boolean,
    previous: twgl.FramebufferInfo,
    edges: { source: string; target: string; targetHandle?: string | null }[],
    nodes: PNode[],
    prev: ParsedShader["prev"] = [],
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {
      // The node's own target: the cook size, or 1080p for out.
      iResolution: [previous.width, previous.height, 1],
      iTime: this.time,
      iTimeDelta: this.dt,
      iFrame: this.frame - 1,
      iFrameRate: 1 / Math.max(this.dt, 1e-4),
      iDate: this.date(),
      iSampleRate: this.analyser?.context.sampleRate ?? 44100,
      iChannelTime: [this.time, this.time, this.time, this.time],
      iMouse: this.mouse(),
      iCursorCount: (this.pointer.seen ? 1 : 0) + this.roomCursors.length,
      iCursors: cursorArray(this.pointer.seen ? [this.pointer, ...this.roomCursors] : this.roomCursors),
    };
    const resolutions = new Float32Array(12);
    for (let channel = 0; channel < 4; channel++) {
      let tex = this.black;
      let w = 1;
      let h = 1;
      const before = prev.find((item) => item.channel === channel);
      if (feedback && channel === 3) {
        tex = previous.attachments[0] as WebGLTexture;
        w = previous.width;
        h = previous.height;
      } else if (before) {
        const last = this.previousFrame(node, before.label, nodes);
        if (last) {
          tex = last.tex;
          w = last.w;
          h = last.h;
        }
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
      const sampling = channelSampling(node.data.kind === "shader" ? node.data.params : params, channel);
      values[`iChannel${channel}`] = tex && tex !== this.black ? this.sampled(tex, sampling) : tex;
      resolutions[channel * 3] = w;
      resolutions[channel * 3 + 1] = h;
      resolutions[channel * 3 + 2] = 1;
    }
    values.iChannelResolution = resolutions;
    const live = node.data.kind === "shader" ? node.data.params : params;
    const floats = live.filter((param) => param.kind === "float").map(shaderNumberPar);
    const cooked = resolvePars(node.id, floats, this.exprEnv(nodes)).num;
    for (const param of live) {
      if (param.kind === "float") values[param.name] = cooked[param.name] ?? param.value;
      else if (param.kind === "color") values[param.name] = param.value;
    }
    return values;
  }

  /** ShaderToy iDate: year, month (0-based), day, seconds since midnight. A fixed cook pins it to 2024-01-01 10:00 + t. */
  private date(): number[] {
    if (this.launch.fixed) return [2024, 0, 1, 36000 + this.time];
    const now = new Date();
    const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    return [now.getFullYear(), now.getMonth(), now.getDate(), seconds];
  }

  private outputTexture(node: PNode): Output | null {
    const image = this.images.get(node.id);
    if (image) return image;
    if (node.data.kind === "audio" && this.audioTex) return { tex: this.audioTex, w: 512, h: 2 };
    const rt = this.runtime.get(node.id);
    if (!rt) return null;
    return { tex: rt.front.attachments[0] as WebGLTexture, w: rt.front.width, h: rt.front.height };
  }

  private blitPreviews(nodes: PNode[]): void {
    const gl = this.gl;
    const canvas = gl?.canvas as HTMLCanvasElement | undefined;
    if (!gl || !canvas || !this.copy) return;
    for (const node of nodes) {
      const ctx = this.previews.get(node.id);
      const output = this.outputTexture(node);
      if (!ctx || !output) continue;
      this.blitTexture(output.tex, THUMB_W, THUMB_H);
      const y = gl.drawingBufferHeight - THUMB_H;
      ctx.drawImage(canvas, 0, y, THUMB_W, THUMB_H, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  private blitImage(node: PNode, dest: HTMLCanvasElement, ctx: CanvasRenderingContext2D, size: { w: number; h: number }): Output | null {
    const gl = this.gl;
    const canvas = gl?.canvas as HTMLCanvasElement | undefined;
    if (!gl || !canvas) return null;
    const output = this.outputTexture(node);
    if (!output) return null;
    fitCanvas(dest, size);
    // Letterbox so a 16:9 cook keeps its shape in any panel. The audio strip (512×2) still stretches.
    let w = size.w;
    let h = size.h;
    if (output.h > 2) {
      const scale = Math.min(size.w / output.w, size.h / output.h);
      w = Math.max(2, Math.round(output.w * scale));
      h = Math.max(2, Math.round(output.h * scale));
    }
    const x = Math.floor((size.w - w) / 2);
    const y = Math.floor((size.h - h) / 2);
    if (dest === this.viewer) this.picture = { x: x / size.w, y: y / size.h, w: w / size.w, h: h / size.h };
    this.blitTexture(output.tex, w, h);
    if (w !== size.w || h !== size.h) {
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, size.w, size.h);
    }
    ctx.drawImage(canvas, 0, gl.drawingBufferHeight - h, w, h, x, y, w, h);
    return output;
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
    // Samplers override texture state per unit; leave no unit bound for the next pass.
    for (let unit = 0; unit < 4; unit++) gl.bindSampler(unit, null);
  }

  /**
   * A texture with the input's filter and wrap. linear/clamp is the texture's own state and
   * binds no sampler. mipmap regenerates the chain once per cook. RGBA32F without
   * OES_texture_float_linear can neither filter nor mip, so it samples nearest.
   */
  private sampled(tex: WebGLTexture, sampling: { filter: string; wrap: string }): WebGLTexture | { texture: WebGLTexture; sampler: WebGLSampler } {
    const gl = this.gl;
    if (!gl || (sampling.filter === "linear" && sampling.wrap === "clamp")) return tex;
    const filterable = this.floatLinear || !this.fullTextures.has(tex);
    let filter = filterable ? sampling.filter : "nearest";
    if (filter === "mipmap" && this.mipped.get(tex) !== this.cookSerial) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.getError();
      gl.generateMipmap(gl.TEXTURE_2D);
      if (gl.getError() === gl.NO_ERROR) this.mipped.set(tex, this.cookSerial);
      else filter = "linear";
    }
    const key = `${filter}/${sampling.wrap}`;
    let sampler = this.samplers.get(key);
    if (!sampler) {
      sampler = gl.createSampler();
      const wrap = sampling.wrap === "repeat" ? gl.REPEAT : sampling.wrap === "mirror" ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
      const min = filter === "mipmap" ? gl.LINEAR_MIPMAP_LINEAR : filter === "nearest" ? gl.NEAREST : gl.LINEAR;
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, min);
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, filter === "nearest" ? gl.NEAREST : gl.LINEAR);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, wrap);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, wrap);
      this.samplers.set(key, sampler);
    }
    return { texture: tex, sampler };
  }

  private testOutput(info: twgl.ProgramInfo, params: ShaderParam[]): string | null {
    const gl = this.gl;
    if (!gl || !this.testTarget || !this.pattern || !this.black) return "test framebuffer missing";
    const values: Record<string, unknown> = {
      iResolution: [TEST_W, TEST_H, 1],
      iTime: 0.35,
      iTimeDelta: 0.016,
      iFrame: 3,
      iFrameRate: 60,
      iDate: [2024, 0, 1, 36000.35],
      iSampleRate: 44100,
      iChannelTime: [0.35, 0.35, 0.35, 0.35],
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

  /** `feedback` here means double-buffered: @feedback itself, or read by someone's @prev. */
  private install(id: string, source: string, info: twgl.ProgramInfo, feedback: boolean, size: { w: number; h: number }): Runtime {
    const existing = this.runtime.get(id);
    if (existing) {
      existing.source = source;
      existing.info = info;
      if (feedback && !existing.back && this.gl) {
        freeTarget(this.gl, existing.front);
        existing.front = this.makeTarget(size.w, size.h, true);
        existing.back = this.makeTarget(size.w, size.h, true);
      }
      if (!feedback && existing.back && this.gl) {
        freeTarget(this.gl, existing.back);
        existing.back = null;
      }
      return existing;
    }
    const created: Runtime = {
      source,
      info,
      front: this.makeTarget(size.w, size.h, feedback),
      back: feedback ? this.makeTarget(size.w, size.h, true) : null,
      cooked: 0,
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
    this.pops = new PopBank(gl);
    this.imageOps = new ImageOps(gl);
    this.byteTarget = twgl.createFramebufferInfo(
      gl,
      [{ format: gl.RGBA, type: gl.UNSIGNED_BYTE, min: gl.NEAREST, mag: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE }],
      TEST_W,
      TEST_H,
    );
  }

  /**
   * RGBA16F by default. Feedback buffers are RGBA32F like ShaderToy's buffers: a half float
   * rounds away per-frame steps below its ulp, so integrators stall or jump in bands.
   */
  private makeTarget(w: number, h: number, full = false): twgl.FramebufferInfo {
    const gl = this.gl;
    if (!gl) throw new Error("no gl");
    const filter = full && !this.floatLinear ? gl.NEAREST : gl.LINEAR;
    const attach = {
      internalFormat: full ? gl.RGBA32F : gl.RGBA16F,
      format: gl.RGBA,
      type: full ? gl.FLOAT : gl.HALF_FLOAT,
      min: filter,
      mag: filter,
      wrap: gl.CLAMP_TO_EDGE,
    };
    const fbi = twgl.createFramebufferInfo(gl, [attach], w, h);
    if (full) this.fullTextures.add(fbi.attachments[0] as WebGLTexture);
    twgl.bindFramebufferInfo(gl, fbi);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      freeTarget(gl, fbi);
      const nearest = twgl.createFramebufferInfo(gl, [{ ...attach, min: gl.NEAREST, mag: gl.NEAREST }], w, h);
      if (full) this.fullTextures.add(nearest.attachments[0] as WebGLTexture);
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
        this.spectrum[i] = spec;
        writeTexel(pixels, i, spec);
        writeTexel(pixels, 512 + i, sample);
      }
    } else {
      for (let i = 0; i < 512; i++) {
        const f = i / 512;
        const spec = Math.pow(Math.max(0, Math.sin(this.time * 2.2 + f * 18) * 0.5 + 0.5), 2) * Math.exp(-f * 1.6);
        const sample = Math.sin(f * 36 + this.time * 5) * 0.5 + 0.5;
        this.spectrum[i] = spec;
        writeTexel(pixels, i, spec);
        writeTexel(pixels, 512 + i, sample);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }

  /**
   * Sizes the hidden canvas once per presented frame to fit both a thumb and the viewer.
   * Each blit only sets its viewport in the bottom-left corner and copies that rect out.
   */
  private ensureDrawingBuffer(): void {
    const canvas = this.gl?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return;
    const size = this.viewerPixels();
    fitCanvas(canvas, { w: Math.max(size.w, THUMB_W), h: Math.max(size.h, THUMB_H) });
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
    // Normalized to the letterboxed picture, not the whole panel, so iMouse lands on what you point at.
    const box = this.picture ?? { x: 0, y: 0, w: 1, h: 1 };
    const u = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const v = (event.clientY - rect.top) / Math.max(rect.height, 1);
    this.pointer.x = clamp01((u - box.x) / box.w);
    this.pointer.y = clamp01(1 - (v - box.y) / box.h);
    this.pointer.seen = true;
    if (this.pointer.down) {
      this.pointer.dragX = this.pointer.x;
      this.pointer.dragY = this.pointer.y;
    }
    this.emitPointer();
  }

  /**
   * ShaderToy iMouse: xy = last position while the button was down, |zw| = where it went down,
   * z > 0 while held, w > 0 only on the click frame. All zero until the first click.
   * Hover without a button only reaches iCursors.
   */
  private mouse(): number[] {
    const p = this.pointer;
    if (!p.ever) return [0, 0, 0, 0];
    return [p.dragX * COOK_W, p.dragY * COOK_H, (p.down ? 1 : -1) * p.clickX * COOK_W, (p.clicked ? 1 : -1) * p.clickY * COOK_H];
  }

  private emitPointer(): void {
    this.onPointer?.({ x: this.pointer.x, y: this.pointer.y, down: this.pointer.down });
  }

  /**
   * A context loss soon after a commit is pinned on that shader: its source is never compiled
   * again this session (the restore and any peer copy skip it), and the node falls back to the
   * source it had before. Editing the code gives it a new hash and a new try.
   */
  private blameLoss(): string | null {
    const suspect = this.suspect;
    this.suspect = null;
    if (!suspect || performance.now() - suspect.at > SUSPECT_MS) return null;
    this.poisoned.add(hash(suspect.source));
    const node = useGraph.getState().nodes.find((item) => item.id === suspect.id);
    if (!node || node.data.kind !== "shader") return null;
    const good = suspect.good && !this.poisoned.has(hash(suspect.good)) ? suspect.good : undefined;
    useGraph.getState().applyCompile(suspect.id, { status: "error", error: GPU_TIMEOUT, committed: good });
    return node.data.label;
  }

  private fail(message: string): void {
    this.failed = message;
    useGraph.getState().setGpuError(message);
  }
}

/** Assigning width or height clears a canvas even when the value is unchanged. */
function fitCanvas(canvas: HTMLCanvasElement, size: { w: number; h: number }): void {
  if (canvas.width !== size.w) canvas.width = size.w;
  if (canvas.height !== size.h) canvas.height = size.h;
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

function quantize(value: number): number {
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

function isLight(node: PNode): boolean {
  return node.data.kind === "op" && node.data.family === "COMP" && node.data.type === "light";
}

/** `*` is every light; otherwise labels separated by spaces or commas, each may use `*` as a wildcard. */
export function matchesPattern(pattern: string, label: string): boolean {
  return pattern
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((word) => new RegExp("^" + word.replace(/[.+?^$()|[\]\\{}]/g, "\\$&").replace(/\*/g, ".*") + "$").test(label));
}

function phongLook(num: Record<string, number>): PhongLook {
  return {
    size: num.size ?? 0.05,
    diff: [num.diffr ?? 1, num.diffg ?? 1, num.diffb ?? 1],
    spec: [num.specr ?? 1, num.specg ?? 1, num.specb ?? 1],
    amb: [num.ambr ?? 0.15, num.ambg ?? 0.15, num.ambb ?? 0.15],
    emit: [num.emitr ?? 0, num.emitg ?? 0, num.emitb ?? 0],
    shininess: num.shininess ?? 40,
  };
}
