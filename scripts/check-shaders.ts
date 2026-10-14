import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { FULLSCREEN_VS } from "../src/engine/fullscreen";
import { wrapShader } from "../src/engine/wrap";
import { launchBrowser } from "./browser";

const root = path.resolve(import.meta.dir, "..");
const ops = path.join(root, "src/ops");
const files = readdirSync(ops)
  .filter((name) => name.endsWith(".glsl"))
  .sort();

if (files.length === 0) {
  console.error("no shaders in src/ops");
  process.exit(1);
}

const sources = files.map((name) => ({
  name,
  source: wrapShader(readFileSync(path.join(ops, name), "utf8")).source,
}));

const edge = await launchBrowser();
try {
  const page = await edge.newPage();
  page.on("pageerror", (error) => console.error(error));
  await page.setContent(`<!doctype html><canvas id="c" width="4" height="4"></canvas>`);
  const failures = await page.evaluate(
    ({ vertex, shaders }) => {
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
          [gl.VERTEX_SHADER, vertex],
          [gl.FRAGMENT_SHADER, shader.source],
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
    { vertex: FULLSCREEN_VS, shaders: sources },
  );
  if (failures.length) {
    for (const failure of failures) {
      console.error(`\n${failure.name}\n${failure.log}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`compiled ${files.length} shaders (${files.join(", ")})`);
  }
} finally {
  await edge.close();
}
