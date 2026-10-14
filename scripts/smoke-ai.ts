// One goal through the AI assistant in a fresh room: the agent must finish without error, change the
// graph, succeed at a mutating tool and look at a frame. Needs `bun run dev` and `bun run server`
// with ANTHROPIC_API_KEY. Spends real money.
//   bun run smoke:ai ["goal"] [--follow "next goal"] [--stop-after-tools n]
import type { Page } from "playwright";
import type { Entry } from "../src/ai/client";
import { launchBrowser } from "./browser";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
};
const follow = flag("--follow");
const stopAfter = flag("--stop-after-tools");
const goal = args[0] ?? "make the point cloud bigger and red, then confirm by looking at out";
const room = `ai-${Date.now().toString(36)}`;
const url = `http://localhost:5173/r/${room}`;
const TURN_MS = 240_000;
const READS = new Set(["get_graph", "read_shader", "view"]);

let failed = false;
const problems: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function health(): Promise<number> {
  const body = (await (await fetch("http://localhost:3000/health")).json()) as { ai: { sessions: number } };
  return body.ai.sessions;
}

const app = (page: Page, path: string): Promise<string> =>
  page.evaluate(
    (path) =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => new URL(name).pathname === path) ?? path,
    path,
  );

const graphText = async (page: Page): Promise<string> =>
  page.evaluate(async (url) => (await import(url)).graphText() as string, await app(page, "/src/ai/execute.ts"));

const structure = (text: string): string =>
  text
    .split("\n")
    .slice(1)
    .join("\n")
    .replace(/\)=-?[\d.e+-]+/g, ")");

const transcript = async (page: Page): Promise<Entry[]> =>
  page.evaluate(async (url) => {
    const state = (await import(url)).useAssistant.getState() as { transcript: Entry[] };
    return state.transcript.map((entry) => (entry.kind === "tool" ? { ...entry, images: entry.images.map((data) => String(data.length)) } : entry));
  }, await app(page, "/src/ai/client.ts"));

const spent = async (page: Page): Promise<number> =>
  page.evaluate(async (url) => (await import(url)).useAssistant.getState().cost as number, await app(page, "/src/ai/client.ts"));

const outFed = async (page: Page): Promise<boolean> =>
  page.evaluate(
    async (url) => ((await import(url)).useGraph.getState().edges as { target: string; targetHandle?: string | null }[]).some((edge) => edge.target === "out" && edge.targetHandle === "ch0"),
    await app(page, "/src/store.ts"),
  );

async function turn(page: Page, text: string, done: number): Promise<void> {
  await page.fill(".assistant textarea", text);
  await page.press(".assistant textarea", "Enter");
  await page.waitForFunction(
    (done) => document.querySelectorAll(".assistant-log .say-done, .assistant-log .say-error").length > done,
    done,
    { timeout: TURN_MS, polling: 500 },
  );
}

function print(entries: Entry[]): void {
  for (const entry of entries) {
    if (entry.kind === "tool") {
      const first = entry.result.split("\n")[0] ?? "";
      const images = entry.images.length ? `  [${entry.images.length} image${entry.images.length === 1 ? "" : "s"}]` : "";
      console.log(`  ${entry.isError ? "!" : "·"} ${entry.name.padEnd(12)} ${first}${images}`);
    } else if (entry.kind === "text") console.log(`  > ${entry.text.trim().replace(/\n+/g, " ")}`);
    else if (entry.kind === "user") console.log(`  goal: ${entry.text}`);
    else if (entry.kind === "done") console.log(`  done: ${entry.isError ? `ERROR ${entry.message}` : "ok"}  turns ${entry.turns}  $${entry.cost.toFixed(3)}`);
    else console.log(`  error: ${entry.message}`);
  }
}

function judge(name: string, entries: Entry[], before: string, after: string, expectChange: boolean): void {
  const done = entries.filter((entry) => entry.kind === "done").at(-1);
  const errors = entries.filter((entry) => entry.kind === "error");
  const tools = entries.flatMap((entry) => (entry.kind === "tool" ? [entry] : []));
  check(`${name}: done entry is not an error`, done?.kind === "done" && !done.isError && errors.length === 0, done?.kind === "done" ? done.message.split("\n")[0] : errors.map((e) => e.kind === "error" && e.message).join("; "));
  check(`${name}: no tool left pending`, tools.every((tool) => !tool.pending));
  if (!expectChange) return;
  check(`${name}: a mutating tool succeeded`, tools.some((tool) => !READS.has(tool.name) && !tool.isError));
  check(`${name}: the graph changed`, structure(before) !== structure(after));
  check(`${name}: view returned an image`, tools.some((tool) => tool.name === "view" && !tool.isError && tool.images.length > 0));
}

const browser = await launchBrowser();
try {
  check("server has no AI session before", (await health()) === 0);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForSelector(".room.is-connected", { timeout: 15_000 });
  await page.waitForSelector(".assistant textarea:not([disabled])", { timeout: 15_000 });
  await page.waitForSelector(".op-node", { timeout: 15_000 });
  console.log(`room ${url}`);

  let before = await graphText(page);
  let entries: Entry[] = [];
  if (stopAfter !== undefined) {
    await page.fill(".assistant textarea", goal);
    await page.press(".assistant textarea", "Enter");
    await page.waitForFunction((n) => document.querySelectorAll(".assistant-log .say-tool:not(.is-pending)").length >= n, Number(stopAfter), {
      timeout: TURN_MS,
      polling: 200,
    });
    await page.click(".assistant-stop");
    const t0 = Date.now();
    await page.waitForFunction(() => document.querySelectorAll(".assistant-log .say-done, .assistant-log .say-error").length > 0, undefined, {
      timeout: 60_000,
      polling: 200,
    });
    entries = await transcript(page);
    print(entries);
    const done = entries.findLast((entry) => entry.kind === "done");
    check("stop ends the turn", done?.kind === "done", `${Date.now() - t0} ms, ${done?.kind === "done" ? done.message : "no done"}`);
    check("stop leaves the panel idle", await page.isVisible(".assistant textarea:not([disabled])"));
    check("no tool left pending after stop", entries.every((entry) => entry.kind !== "tool" || !entry.pending));
    before = await graphText(page);
    if (follow) {
      await turn(page, follow, 1);
      entries = await transcript(page);
      print(entries.slice(entries.findLastIndex((entry) => entry.kind === "user")));
      judge("after stop", entries.slice(entries.findLastIndex((entry) => entry.kind === "user")), before, await graphText(page), true);
    }
  } else {
    await turn(page, goal, 0);
    entries = await transcript(page);
    print(entries);
    const after = await graphText(page);
    judge("goal", entries, before, after, true);
    if (follow) {
      await turn(page, follow, 1);
      const all = await transcript(page);
      const next = all.slice(entries.length);
      print(next);
      judge("follow-up", next, after, await graphText(page), true);
      entries = all;
    }
  }
  check("out.ch0 is fed", await outFed(page));
  const cost = await spent(page);
  console.log(`cost $${cost.toFixed(3)}`);
  console.log("graph now:");
  console.log((await graphText(page)).replace(/^/gm, "  "));
  await page.close();
  const deadline = Date.now() + 10_000;
  while ((await health()) > 0 && Date.now() < deadline) await Bun.sleep(200);
  check("server AI sessions back to 0 after the tab closed", (await health()) === 0);
} catch (error) {
  check("smoke", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}
for (const problem of problems) console.error(problem);
check("no console or page errors", problems.length === 0, problems.length ? `${problems.length}` : "");
process.exit(failed ? 1 : 0);
