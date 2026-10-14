import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FULLSCREEN_VS } from "../src/engine/fullscreen";
import { wrapShader } from "../src/engine/wrap";
import { launchBrowser } from "./browser";

const root = path.resolve(import.meta.dir, "..");
const ops = path.join(root, "src/ops");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) found.push(...walk(file));
    else if (name.endsWith(".glsl")) found.push(file);
  }
  return found.sort();
}

const files = walk(ops);
if (files.length === 0) {
  console.error("no shaders in src/ops");
  process.exit(1);
}

interface Program {
  name: string;
  vertex: string;
  fragment: string;
}

const consumed = new Set<string>();
const programs: Program[] = [];

for (const file of files) {
  if (!file.endsWith(".vert.glsl")) continue;
  const fragmentPath = file.replace(/\.vert\.glsl$/, ".frag.glsl");
  if (!files.includes(fragmentPath)) {
    console.error(`missing fragment shader for ${path.relative(root, file)}`);
    process.exit(1);
  }
  consumed.add(file);
  consumed.add(fragmentPath);
  programs.push({
    name: path.relative(ops, file),
    vertex: readFileSync(file, "utf8"),
    fragment: readFileSync(fragmentPath, "utf8"),
  });
}

for (const file of files) {
  if (consumed.has(file)) continue;
  const source = readFileSync(file, "utf8");
  const fragment = source.includes("#version") ? source : wrapShader(source).source;
  programs.push({
    name: path.relative(ops, file),
    vertex: FULLSCREEN_VS,
    fragment,
  });
}

const edge = await launchBrowser();
try {
  const page = await edge.newPage();
  page.on("pageerror", (error) => console.error(error));
  await page.setContent(`<!doctype html><canvas id="c" width="4" height="4"></canvas>`);
  const failures = await page.evaluate(
    (shaders) => {
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
      if (!gl) return [{ name: "(context)", log: "WebGL2 is missing" }];
      if (!gl.getExtension("EXT_color_buffer_float")) {
        return [{ name: "(context)", log: "EXT_color_buffer_float is missing. Refusing to fall back to RGBA8." }];
      }
      const problems: { name: string; log: string }[] = [];
      for (const shader of shaders) {
        const program = gl.createProgram();
        if (!program) {
          problems.push({ name: shader.name, log: "createProgram returned null" });
          continue;
        }
        const logs: string[] = [];
        for (const [type, source] of [
          [gl.VERTEX_SHADER, shader.vertex],
          [gl.FRAGMENT_SHADER, shader.fragment],
        ] as const) {
          const compiled = gl.createShader(type);
          if (!compiled) {
            logs.push("createShader returned null");
            continue;
          }
          gl.shaderSource(compiled, source);
          gl.compileShader(compiled);
          if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
            logs.push(gl.getShaderInfoLog(compiled) || "compile failed");
          }
          gl.attachShader(program, compiled);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          logs.push(gl.getProgramInfoLog(program) || "link failed");
        }
        gl.deleteProgram(program);
        if (logs.length) problems.push({ name: shader.name, log: logs.join("\n") });
      }
      return problems;
    },
    programs,
  );
  if (failures.length) {
    for (const failure of failures) console.error(`\n${failure.name}\n${failure.log}`);
    process.exitCode = 1;
  } else {
    console.log(`compiled ${programs.length} shaders (${programs.map((item) => item.name).join(", ")})`);
  }
} finally {
  await edge.close();
}
