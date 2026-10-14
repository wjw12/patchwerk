// WebGL for the landing page: the frontiers2026 template cooking behind the hero, and single-pass
// ShaderToy previews. Same wrapper as the engine, none of the graph machinery.
import * as twgl from "twgl.js";
import { FULLSCREEN_VS } from "../../engine/fullscreen";
import { wrapShader } from "../../engine/wrap";
import hydraO1 from "../../ops/hydra-o1.glsl?raw";
import hydraO5 from "../../ops/hydra-o5.glsl?raw";
import hydraPost from "../../ops/hydra-post.glsl?raw";

/** CSS pixels per cooked hydra pixel. The cells stay visible as a grid. */
const CELL = 3;

const GRADE_FS = `#version 300 es
precision highp float;
uniform sampler2D uPost;
uniform vec2 uRes;
uniform vec2 uCook;
uniform vec2 uMouse;
uniform float uLens;
uniform float uTime;
uniform float uIntro;
uniform float uDpr;
out vec4 fragColor;

const vec3 INK = vec3(0.071, 0.043, 0.09);
const vec3 PINK = vec3(1.0, 0.13, 0.6);
const vec3 LIME = vec3(0.84, 1.0, 0.24);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;

  // Rows that slip sideways in short bursts.
  float tick = floor(uTime * 10.0);
  float band = floor(uv.y * 38.0);
  float burst = step(0.9, hash(vec2(floor(uTime * 2.5), 3.0)));
  float slip = (hash(vec2(band, tick)) - 0.5) * step(0.72, hash(vec2(band * 1.7, tick))) * burst;
  uv.x += slip * 0.12;

  vec2 cell = floor(uv * uCook);
  vec3 raw = texture(uPost, (cell + 0.5) / uCook).rgb;

  float pinkness = clamp((raw.r - raw.g) * 1.8, 0.0, 1.0);
  float limeness = clamp((raw.g - raw.b) * 1.6 - pinkness, 0.0, 1.0);
  float lum = dot(raw, vec3(0.2125, 0.7154, 0.0721));
  vec3 graded = INK + PINK * pinkness * 0.4 + LIME * limeness * 0.2 + vec3(0.62, 0.5, 0.85) * lum * (1.0 - pinkness - limeness) * 0.14;
  graded += PINK * abs(slip) * 0.7;

  // Darker where the headline sits and toward the bottom edge, so text and the next section read.
  vec2 centered = (frag - uRes * vec2(0.5, 0.6)) / uRes.y;
  float hush = smoothstep(0.75, 0.05, length(centered * vec2(0.7, 1.15)));
  float floorFade = smoothstep(0.0, 0.32, uv.y);
  graded = mix(graded, INK, hush * 0.65);
  graded = mix(INK, graded, floorFade);

  // The pointer is a lens onto the raw output.
  float d = length(frag - uMouse) / uDpr;
  float lens = (1.0 - smoothstep(150.0, 170.0, d)) * uLens;
  float rim = (smoothstep(146.0, 152.0, d) - smoothstep(166.0, 172.0, d)) * uLens;
  vec3 color = mix(graded, raw * 1.05, lens) + PINK * rim * 0.9;

  // Cells boot in at random.
  color = mix(INK, color, step(hash(cell), uIntro * 1.15 - 0.1));

  vec2 local = fract(uv * uCook) * (uRes / uCook);
  float gap = step(local.x, 1.0) + step(local.y, 1.0);
  color *= 1.0 - min(gap, 1.0) * 0.38;

  fragColor = vec4(color, 1.0);
}
`;

const WINDOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uRect;
uniform float uRadius;
uniform vec2 uCook;
uniform float uMap;
out vec4 fragColor;

void main() {
  vec2 local = gl_FragCoord.xy - uRect.xy;
  vec2 uv = local / uRect.zw;
  float rectAspect = uRect.z / uRect.w;
  float texAspect = uCook.x / uCook.y;
  vec2 fit = rectAspect > texAspect ? vec2(1.0, texAspect / rectAspect) : vec2(rectAspect / texAspect, 1.0);
  vec3 c = texture(uTex, (uv - 0.5) * fit + 0.5).rgb;
  // o1 and o5 are grey: gradient-map them through the palette and lift them.
  float l = clamp((dot(c, vec3(0.2125, 0.7154, 0.0721)) - 0.08) * 1.35, 0.0, 1.0);
  vec3 mapped = mix(vec3(0.16, 0.05, 0.22), vec3(1.0, 0.13, 0.6), smoothstep(0.0, 0.55, l));
  mapped = mix(mapped, vec3(1.0, 0.86, 0.95), smoothstep(0.55, 1.0, l));
  c = mix(c * 1.15, mapped, uMap);
  // Only the bottom corners round; the card header sits on top.
  float radius = local.y < uRect.w * 0.5 ? uRadius : 0.0;
  vec2 q = abs(local - uRect.zw * 0.5) - (uRect.zw * 0.5 - radius);
  float d = length(max(q, 0.0)) - radius;
  float a = clamp(0.5 - d, 0.0, 1.0);
  fragColor = vec4(c * a, a);
}
`;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function context(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: true });
  if (!gl) return null;
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("OES_texture_float_linear");
  return gl;
}

function triangle(gl: WebGL2RenderingContext): twgl.BufferInfo {
  return twgl.createBufferInfoFromArrays(gl, { aPos: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] } });
}

function program(gl: WebGL2RenderingContext, fragment: string): twgl.ProgramInfo {
  const info = twgl.createProgramInfo(gl, [FULLSCREEN_VS, fragment], (message) => console.error(message));
  if (!info) throw new Error("landing shader failed to compile");
  return info;
}

function floatTarget(gl: WebGL2RenderingContext, w: number, h: number): twgl.FramebufferInfo {
  return twgl.createFramebufferInfo(
    gl,
    [{ internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, min: gl.NEAREST, mag: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE }],
    w,
    h,
  );
}

function sampling(gl: WebGL2RenderingContext, tex: WebGLTexture, filter: "nearest" | "linear"): WebGLTexture {
  const mode = filter === "nearest" ? gl.NEAREST : gl.LINEAR;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mode);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mode);
  return tex;
}

/** Sizes the canvas to its box, runs `frame` while it is on screen, and stops on the returned call. */
function loop(canvas: HTMLCanvasElement, frame: (seconds: number, resized: boolean) => void): () => void {
  let raf = 0;
  let visible = true;
  let start = -1;
  let frames = 0;
  const still = reducedMotion();
  const tick = (now: number) => {
    raf = 0;
    if (start < 0) start = now;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    const resized = canvas.width !== w || canvas.height !== h;
    if (resized) {
      canvas.width = w;
      canvas.height = h;
    }
    frame((now - start) / 1000, resized);
    frames++;
    // Reduced motion: cook long enough for the feedback to fill in, then hold the picture.
    if (visible && !(still && frames > 150)) raf = requestAnimationFrame(tick);
  };
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry!.isIntersecting;
    if (visible && !raf && !(still && frames > 150)) raf = requestAnimationFrame(tick);
  });
  seen.observe(canvas);
  return () => {
    seen.disconnect();
    cancelAnimationFrame(raf);
    raf = -1;
  };
}

function pointerOn(canvas: HTMLCanvasElement) {
  const pointer = { x: 0.5, y: 0.5, inside: false };
  const move = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - box.left) / box.width;
    pointer.y = 1 - (event.clientY - box.top) / box.height;
    pointer.inside = pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1 && event.pointerType === "mouse";
  };
  const leave = () => (pointer.inside = false);
  window.addEventListener("pointermove", move);
  document.addEventListener("pointerleave", leave);
  return { pointer, off: () => (window.removeEventListener("pointermove", move), document.removeEventListener("pointerleave", leave)) };
}

export type HydraStage = "o1" | "o5" | "post";

export interface HeroOptions {
  /** DOM boxes that show one hydra stage raw, drawn into the canvas under them. */
  windows: () => { el: HTMLElement; stage: HydraStage; radius: number }[];
  onFrame?: (seconds: number) => void;
}

/** The frontiers2026 template (o1 → o5 → post) cooking full-bleed, graded into the page palette. */
export function hydraHero(canvas: HTMLCanvasElement, options: HeroOptions): () => void {
  const gl = context(canvas);
  if (!gl) return () => {};
  const tri = triangle(gl);
  const stages = {
    o1: program(gl, wrapShader(hydraO1).source),
    o5: program(gl, wrapShader(hydraO5).source),
    post: program(gl, wrapShader(hydraPost).source),
  };
  const grade = program(gl, GRADE_FS);
  const win = program(gl, WINDOW_FS);
  const { pointer, off } = pointerOn(canvas);

  let cook: [number, number] = [1, 1];
  let targets: { o1: twgl.FramebufferInfo[]; o5: twgl.FramebufferInfo[]; post: twgl.FramebufferInfo } | null = null;
  let frame = 0;
  let lens = 0;

  const free = () => {
    if (!targets) return;
    for (const fb of [...targets.o1, ...targets.o5, targets.post]) {
      gl.deleteFramebuffer(fb.framebuffer);
      for (const tex of fb.attachments) gl.deleteTexture(tex as WebGLTexture);
    }
  };

  const pass = (info: twgl.ProgramInfo, target: twgl.FramebufferInfo | null, uniforms: Record<string, unknown>) => {
    twgl.bindFramebufferInfo(gl, target);
    gl.useProgram(info.program);
    twgl.setBuffersAndAttributes(gl, info, tri);
    twgl.setUniforms(info, uniforms);
    twgl.drawBufferInfo(gl, tri);
  };

  const stop = loop(canvas, (seconds, resized) => {
    if (resized || !targets) {
      free();
      const dpr = canvas.width / Math.max(1, canvas.clientWidth);
      cook = [Math.ceil(canvas.width / dpr / CELL), Math.ceil(canvas.height / dpr / CELL)];
      targets = {
        o1: [floatTarget(gl, ...cook), floatTarget(gl, ...cook)],
        o5: [floatTarget(gl, ...cook), floatTarget(gl, ...cook)],
        post: floatTarget(gl, ...cook),
      };
      frame = 0;
    }
    const time = seconds + 4;
    const res = [cook[0], cook[1], 1];
    const flip = frame % 2;
    const o1 = targets.o1[flip]!;
    const o1Prev = targets.o1[1 - flip]!;
    const o5 = targets.o5[flip]!;
    const o5Prev = targets.o5[1 - flip]!;
    const tex = (fb: twgl.FramebufferInfo) => fb.attachments[0] as WebGLTexture;

    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    pass(stages.o1, o1, { iResolution: res, iTime: time, iFrame: frame, iChannel3: sampling(gl, tex(o1Prev), "nearest") });
    pass(stages.o5, o5, {
      iResolution: res,
      iTime: time,
      iFrame: frame,
      iChannel0: sampling(gl, tex(o1), "linear"),
      iChannel3: sampling(gl, tex(o5Prev), "nearest"),
    });
    pass(stages.post, targets.post, {
      iResolution: res,
      iTime: time,
      iFrame: frame,
      iChannel0: sampling(gl, tex(o1), "linear"),
      iChannel1: sampling(gl, tex(o5), "linear"),
    });
    frame++;

    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    lens += ((pointer.inside ? 1 : 0) - lens) * 0.08;
    gl.viewport(0, 0, canvas.width, canvas.height);
    pass(grade, null, {
      uPost: sampling(gl, tex(targets.post), "nearest"),
      uRes: [canvas.width, canvas.height],
      uCook: cook,
      uMouse: [pointer.x * canvas.width, pointer.y * canvas.height],
      uLens: lens,
      uTime: seconds,
      uIntro: Math.min(1, seconds / 1.6),
      uDpr: dpr,
    });

    const box = canvas.getBoundingClientRect();
    const sources = { o1: tex(o1), o5: tex(o5), post: tex(targets.post) };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    for (const { el, stage, radius } of options.windows()) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < box.top || r.top > box.bottom) continue;
      const x = Math.round((r.left - box.left) * dpr);
      const y = Math.round((box.bottom - r.bottom) * dpr);
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      gl.scissor(x, y, w, h);
      pass(win, null, {
        uTex: sampling(gl, sources[stage], stage === "post" ? "nearest" : "linear"),
        uRect: [x, y, w, h],
        uRadius: radius * dpr,
        uCook: cook,
        uMap: stage === "post" ? 0 : 1,
      });
    }
    gl.disable(gl.SCISSOR_TEST);
    options.onFrame?.(seconds);
  });

  return () => {
    stop();
    off();
    free();
  };
}

export interface PreviewCursor {
  x: number;
  y: number;
}

export interface PreviewOptions {
  /** Feeds iChannel0 a 512×2 audio texture (spectrum row, waveform row) from a synthetic beat. */
  audio?: boolean;
  /** Extra cursors after the local one, normalized, as a room would send them. */
  cursors?: (seconds: number) => PreviewCursor[];
  onFrame?: (seconds: number) => void;
}

/** One ShaderToy shader, full canvas, with a source that can be swapped while it runs. */
export function shaderPreview(canvas: HTMLCanvasElement, source: string, options: PreviewOptions = {}) {
  const gl = context(canvas);
  if (!gl) return { setSource: (_source: string) => {}, stop: () => {} };
  const tri = triangle(gl);
  let info = program(gl, wrapShader(source).source);
  let frame = 0;
  const { pointer, off } = pointerOn(canvas);
  const audio = new Uint8Array(512 * 2 * 4);
  const audioTex = twgl.createTexture(gl, {
    width: 512,
    height: 2,
    src: audio,
    min: gl.LINEAR,
    mag: gl.LINEAR,
    wrap: gl.CLAMP_TO_EDGE,
  });

  const stop = loop(canvas, (seconds) => {
    if (options.audio) {
      fillBeat(audio, seconds);
      gl.bindTexture(gl.TEXTURE_2D, audioTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RGBA, gl.UNSIGNED_BYTE, audio);
    }
    const cursors = [...(pointer.inside ? [pointer] : []), ...(options.cursors?.(seconds) ?? [])].slice(0, 8);
    const packed = new Float32Array(32);
    cursors.forEach((cursor, i) => {
      packed[i * 4] = cursor.x;
      packed[i * 4 + 1] = cursor.y;
    });
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(info.program);
    twgl.setBuffersAndAttributes(gl, info, tri);
    twgl.setUniforms(info, {
      iResolution: [canvas.width, canvas.height, 1],
      iTime: seconds,
      iFrame: frame++,
      iMouse: [pointer.x * canvas.width, pointer.y * canvas.height, 0, 0],
      iChannel0: audioTex,
      iCursors: packed,
      iCursorCount: cursors.length,
    });
    twgl.drawBufferInfo(gl, tri);
    options.onFrame?.(seconds);
  });

  return {
    setSource(next: string) {
      gl.deleteProgram(info.program);
      info = program(gl, wrapShader(next).source);
    },
    stop() {
      stop();
      off();
    },
  };
}

/** A 120 bpm kick, offbeat hats and a wandering mid, written the way the engine fills its audio texture. */
function fillBeat(pixels: Uint8Array, t: number): void {
  const kick = Math.exp(-((t * 2) % 1) * 7);
  const hat = Math.exp(-((t * 2 + 0.5) % 1) * 18);
  for (let i = 0; i < 512; i++) {
    const f = i / 512;
    const spec =
      kick * Math.exp(-f * 22) +
      0.45 * Math.exp(-Math.pow((f - 0.18 - 0.06 * Math.sin(t * 0.7)) * 9, 2)) * (0.6 + 0.4 * Math.sin(t * 3.1 + f * 40)) +
      hat * 0.5 * smooth(0.45, 0.8, f) * (0.7 + 0.3 * Math.sin(f * 300 + t * 40));
    const wave = 0.5 + 0.42 * Math.sin(f * 2 * Math.PI * 3 + t * 9) * (0.3 + kick * 0.7) + 0.06 * Math.sin(f * 190 + t * 31);
    write(pixels, i, Math.min(1, spec));
    write(pixels, 512 + i, wave);
  }
}

function smooth(a: number, b: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

function write(pixels: Uint8Array, index: number, value: number): void {
  const v = Math.round(value * 255);
  pixels.set([v, v, v, 255], index * 4);
}
