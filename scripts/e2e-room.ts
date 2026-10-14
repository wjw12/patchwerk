// Two Edge tabs in one room: a node added in A shows up in B, text typed in A lands in B's
// editor, and each tab lists the other as a peer. Needs `bun run dev` and the room server.
import type { Page } from "playwright";
import { launchEdge } from "./browser";

const room = `e2e-${Date.now().toString(36)}`;
const url = `http://localhost:5173/r/${room}`;
const edge = await launchEdge();
let failed = false;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function open(tag: string): Promise<Page> {
  const page = await edge.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => console.error(`${tag} pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`${tag} console: ${msg.text()}`);
  });
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForSelector(".room.is-connected", { timeout: 15_000 });
  return page;
}

try {
  const a = await open("A");
  await a.waitForSelector(".top-node", { timeout: 15_000 });
  const b = await open("B");
  await b.waitForFunction(() => document.querySelectorAll(".top-node").length === 4, undefined, { timeout: 15_000 });
  check("B loads the room seeded by A", true);

  await a.waitForFunction(() => document.querySelectorAll(".topbar .peer").length === 1, undefined, { timeout: 15_000 });
  await b.waitForFunction(() => document.querySelectorAll(".topbar .peer").length === 1, undefined, { timeout: 15_000 });
  check("both tabs list one peer", true);

  await a.click(".topbar-actions button:has-text('shader')");
  await b.waitForFunction(() => document.querySelectorAll(".top-node").length === 5, undefined, { timeout: 10_000 });
  check("node added in A appears in B", true);

  // A has the new node selected and its editor open. Type a comment at the top.
  await a.waitForSelector(".drawer .cm-content", { timeout: 10_000 });
  await a.click(".drawer .cm-content");
  await a.keyboard.press("Control+Home");
  await a.keyboard.type("// hello from A\n");
  const label = await a.$eval(".drawer header b", (el) => el.textContent ?? "");
  // The new node may overlap another one, so select it through React Flow's own click handler.
  await b.dispatchEvent(`.react-flow__node[data-id="${label}"]`, "click");
  await b.waitForFunction(
    () => document.querySelector(".drawer .cm-content")?.textContent?.includes("hello from A") ?? false,
    undefined,
    { timeout: 10_000 },
  );
  check("text typed in A shows in B's editor", true);
  await a.waitForFunction(() => document.querySelectorAll(".drawer .peer").length === 1, undefined, { timeout: 10_000 });
  check("A sees B editing the same shader", true);

  // Both must agree the new shader compiles (committed shared, status local).
  await a.waitForFunction(() => document.querySelector(".drawer header em.ok") != null, undefined, { timeout: 10_000 });
  await b.waitForFunction(() => document.querySelector(".drawer header em.ok") != null, undefined, { timeout: 10_000 });
  check("new shader compiles in both tabs", true);

  // Drag the out node in B; A follows.
  const before = await a.$eval(`.react-flow__node[data-id="out"]`, (el) => el.getBoundingClientRect().left);
  const box = await b.$eval(`.react-flow__node[data-id="out"] header`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await b.mouse.move(box.x, box.y);
  await b.mouse.down();
  for (let i = 1; i <= 10; i++) await b.mouse.move(box.x + i * 12, box.y, { steps: 2 });
  await b.mouse.up();
  await a.waitForFunction(
    (before) => {
      const el = document.querySelector('.react-flow__node[data-id="out"]');
      return el != null && el.getBoundingClientRect().left - before > 40;
    },
    before,
    { timeout: 10_000 },
  );
  check("node dragged in B moves in A", true);

  // Reload B: the room comes back from the server, not from localStorage.
  await b.reload({ waitUntil: "load" });
  await b.waitForFunction(() => document.querySelectorAll(".top-node").length === 5, undefined, { timeout: 15_000 });
  check("B reload restores five nodes from the room", true);
} catch (error) {
  check("e2e", false, error instanceof Error ? error.message : String(error));
} finally {
  await edge.close();
}
process.exit(failed ? 1 : 0);
