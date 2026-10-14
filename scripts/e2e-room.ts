// Two browser tabs in one room: a node added in A shows up in B, text typed in A lands in B's
// editor, and each tab lists the other as a peer. Needs `bun run dev` and the room server.
import type { Page } from "playwright";
import { launchBrowser } from "./browser";

const room = `e2e-${Date.now().toString(36)}`;
const url = `http://localhost:5173/r/${room}`;
const browser = await launchBrowser();
let failed = false;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function open(tag: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => console.error(`${tag} pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`${tag} console: ${msg.text()}`);
  });
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForSelector(".room.is-connected", { timeout: 15_000 });
  return page;
}

const nodeCount = (page: Page, n: number, timeout = 15_000) =>
  page.waitForFunction((n) => document.querySelectorAll(".react-flow__node").length === n, n, { timeout });

try {
  const a = await open("A");
  await a.waitForSelector(".op-node", { timeout: 15_000 });
  const seeded = await a.$$eval(".react-flow__node", (els) => els.length);
  const b = await open("B");
  await nodeCount(b, seeded);
  check("B loads the room seeded by A", true, `${seeded} nodes`);

  await a.waitForFunction(() => document.querySelectorAll(".topbar .peer").length === 1, undefined, { timeout: 15_000 });
  await b.waitForFunction(() => document.querySelectorAll(".topbar .peer").length === 1, undefined, { timeout: 15_000 });
  check("both tabs list one peer", true);

  // Add a shader TOP from the palette: double-click empty network, filter, Enter.
  const pane = await a.$eval(".react-flow__pane", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + 24, y: r.top + 24 };
  });
  await a.mouse.dblclick(pane.x, pane.y);
  await a.waitForSelector(".palette input", { timeout: 5_000 });
  await a.keyboard.type("shader");
  await a.keyboard.press("Enter");
  await nodeCount(b, seeded + 1, 10_000);
  check("node added in A appears in B", true);

  // A has the new node selected and its editor open. Type a comment at the top.
  await a.waitForSelector(".drawer .cm-content", { timeout: 10_000 });
  await a.click(".drawer .cm-content");
  await a.keyboard.press("Control+Home");
  await a.keyboard.type("// hello from A\n");
  const id = await a.$eval(".react-flow__node.selected", (el) => el.getAttribute("data-id") ?? "");
  // The new node may overlap another one, so select it through React Flow's own click handler.
  await b.dispatchEvent(`.react-flow__node[data-id="${id}"]`, "click");
  // The drawer is per tab; B opens it from its own header.
  await b.click(".drawer header button");
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

  // Drag a node in B; A follows. lfo_amp sits top-left, clear of the drawer and minimap.
  const before = await a.$eval(`.react-flow__node[data-id="lfo_amp"]`, (el) => el.getBoundingClientRect().left);
  const box = await b.$eval(`.react-flow__node[data-id="lfo_amp"] header`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await b.mouse.move(box.x, box.y);
  await b.mouse.down();
  for (let i = 1; i <= 10; i++) await b.mouse.move(box.x + i * 12, box.y, { steps: 2 });
  await b.mouse.up();
  await a.waitForFunction(
    (before) => {
      const el = document.querySelector('.react-flow__node[data-id="lfo_amp"]');
      return el != null && el.getBoundingClientRect().left - before > 40;
    },
    before,
    { timeout: 10_000 },
  );
  check("node dragged in B moves in A", true);

  // Reload B: the room comes back from the server, not from localStorage.
  await b.reload({ waitUntil: "load" });
  await nodeCount(b, seeded + 1);
  check("B reload restores every node from the room", true);

  // Undo is per tab: A's Ctrl+Z takes back A's add (not B's drag), for both tabs.
  await a.click(".react-flow__pane", { position: { x: 8, y: 8 } });
  await a.keyboard.press("Control+z");
  await nodeCount(b, seeded);
  check("Ctrl+Z in A removes A's node in B", true);
} catch (error) {
  check("e2e", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
