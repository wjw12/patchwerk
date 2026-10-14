import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import type { Probe } from "../src/probe";
import { cases, region, tolerance, type VisualCase } from "../tests/visual.config";
import { launchBrowser } from "./browser";

const root = path.resolve(import.meta.dir, "..");
const goldenDir = path.join(root, "tests/golden");
const diffDir = path.join(root, "tests/diff");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const update = args.includes("--update");
const named = args.filter((arg) => arg !== "--update");
const selected = named.length ? cases.filter((item) => named.includes(item.name)) : cases;

if (selected.length === 0) {
  console.error(`no visual cases named ${named.join(", ")}`);
  process.exit(1);
}

const edge = await launchBrowser();
let failed = false;
try {
  for (const item of selected) {
    const probe = await render(item);
    if (probe.error || !probe.rgba) {
      console.error(`${item.name}: ${probe.error ?? "empty capture"}`);
      failed = true;
      continue;
    }
    const got = Buffer.from(probe.rgba, "base64");
    if (got.length !== region.width * region.height * 4) {
      console.error(`${item.name}: expected ${region.width}x${region.height} RGBA, got ${got.length} bytes`);
      failed = true;
      continue;
    }
    const goldenPath = path.join(goldenDir, `${item.name}.png`);
    if (update) {
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(goldenPath, PNG.sync.write(pngFrom(got)));
      console.log(`updated ${path.relative(root, goldenPath)}`);
      continue;
    }
    let expected: Buffer;
    try {
      const png = PNG.sync.read(readFileSync(goldenPath));
      expected = Buffer.from(png.data);
      if (png.width !== region.width || png.height !== region.height) {
        throw new Error(`golden is ${png.width}x${png.height}`);
      }
    } catch (error) {
      console.error(`${item.name}: ${error instanceof Error ? error.message : error}`);
      console.error(`missing or unreadable ${path.relative(root, goldenPath)}`);
      console.error(`run: bun run test:visual -- --update ${item.name}`);
      failed = true;
      continue;
    }
    const diff = diffRgba(got, expected);
    if (diff.bad > 0) {
      mkdirSync(diffDir, { recursive: true });
      const diffPath = path.join(diffDir, `${item.name}.png`);
      const gotPath = path.join(diffDir, `${item.name}.got.png`);
      writeFileSync(diffPath, PNG.sync.write(pngFrom(diff.rgba)));
      writeFileSync(gotPath, PNG.sync.write(pngFrom(got)));
      console.error(
        `${item.name}: ${diff.bad} pixels differ by more than ${tolerance}/255\n  diff: ${path.relative(root, diffPath)}\n  got:  ${path.relative(root, gotPath)}`,
      );
      failed = true;
    } else {
      console.log(`${item.name} ok`);
    }
  }
} finally {
  await edge.close();
}

if (failed) process.exit(1);

async function render(item: VisualCase): Promise<Probe> {
  const page = await edge.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => console.error(`${item.name} pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`${item.name} console: ${msg.text()}`);
  });
  const url = `http://localhost:5173/?graph=${encodeURIComponent(item.graph)}&t=${item.t}&frame=${item.frame}`;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => window.__patchwerk?.ready === true, undefined, { timeout: item.frame > 1 ? 180_000 : 30_000 });
    return await page.evaluate(() => window.__patchwerk as Probe);
  } finally {
    await page.close();
  }
}

function pngFrom(rgba: Buffer): PNG {
  const png = new PNG({ width: region.width, height: region.height });
  rgba.copy(png.data);
  return png;
}

function diffRgba(got: Buffer, expected: Buffer): { bad: number; rgba: Buffer } {
  const rgba = Buffer.alloc(got.length);
  let bad = 0;
  for (let i = 0; i < got.length; i += 4) {
    const dr = Math.abs(got[i]! - expected[i]!);
    const dg = Math.abs(got[i + 1]! - expected[i + 1]!);
    const db = Math.abs(got[i + 2]! - expected[i + 2]!);
    const over = dr > tolerance || dg > tolerance || db > tolerance;
    if (over) bad += 1;
    const scale = Math.min(255, Math.max(dr, dg, db) * 8);
    rgba[i] = over ? scale : 0;
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
    rgba[i + 3] = 255;
  }
  return { bad, rgba };
}
