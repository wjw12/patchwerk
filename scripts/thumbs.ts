// Renders every example in tests/graphs a few seconds in and saves the viewer as
// public/thumbs/<name>.jpg for the template picker. Needs `bun run dev`.
//   bun run thumbs            all examples
//   bun run thumbs frontiers2026      just one
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { launchBrowser } from "./browser";

const root = path.resolve(import.meta.dir, "..");
const outDir = path.join(root, "public/thumbs");
// Keep in step with FIXTURES in src/graph-file.ts: graphs that only exist for the visual test.
const FIXTURES = new Set(["feedback-precision", "template"]);
const T = 4;
const FRAMES = 120;

const named = process.argv.slice(2).filter((arg) => arg !== "--");
const all = readdirSync(path.join(root, "tests/graphs"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -".json".length))
  .filter((name) => !FIXTURES.has(name));
const names = named.length ? all.filter((name) => named.includes(name)) : all;

mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
let failed = false;
try {
  for (const name of names) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      const url = `http://localhost:5173/?graph=${encodeURIComponent(`/tests/graphs/${name}.json`)}&t=${T}&frame=${FRAMES}`;
      await page.goto(url, { waitUntil: "load", timeout: 30_000 });
      await page.waitForFunction(() => window.__patchwerk?.ready === true, undefined, { timeout: 180_000 });
      const error = await page.evaluate(() => window.__patchwerk?.error ?? null);
      if (error) throw new Error(error);
      await page.waitForTimeout(300);
      const file = path.join(outDir, `${name}.jpg`);
      // The viewer letterboxes the 16:9 picture; keep only the picture.
      const box = await page.locator(".viewer canvas").boundingBox();
      if (!box) throw new Error("no viewer canvas");
      const height = Math.min(box.height, (box.width * 9) / 16);
      const clip = { x: box.x, y: box.y + (box.height - height) / 2, width: box.width, height };
      await page.screenshot({ path: file, type: "jpeg", quality: 82, clip });
      console.log(`${name} -> ${path.relative(root, file)}`);
    } catch (error) {
      console.error(`${name}: ${error instanceof Error ? error.message : error}`);
      failed = true;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
