import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { TOOLS, type ServerFrame } from "../src/ai/protocol";
import { MODEL, Session } from "./ai";

const GRAPH = `time 1.0s  playing (this tab)  cook 960x540  mic off
people: none
nodes (2)
  glow       TOP/shader      live
  out        TOP/out         live   inlets[ch0]
wires (1)
  glow.out → out.ch0`;

const expected = TOOLS.map((name) => `mcp__patchwerk__${name}`).sort();
const calls: string[] = [];
let tools: string[] | undefined;
let ready: string | undefined;

const done = Promise.withResolvers<Extract<ServerFrame, { type: "done" }>>();
const session: Session = new Session(
  {
    send(data: string) {
      const frame: ServerFrame = JSON.parse(data);
      if (frame.type === "ready") ready = frame.model;
      else if (frame.type === "text") process.stdout.write(frame.text);
      else if (frame.type === "done") done.resolve(frame);
      else if (frame.type === "error") done.reject(new Error(frame.message));
      else if (frame.type === "tool_call") {
        calls.push(frame.name);
        const result =
          frame.name === "get_graph"
            ? { type: "result", id: frame.id, content: [{ type: "text", text: GRAPH }] }
            : { type: "result", id: frame.id, content: [{ type: "text", text: `${frame.name} is not available in this check` }], isError: true };
        queueMicrotask(() => session.receive(JSON.stringify(result)));
      }
    },
    close() {},
  },
  (message: SDKMessage) => {
    if (message.type === "system" && message.subtype === "init") tools = message.tools;
  },
);

const timeout = setTimeout(() => done.reject(new Error("no result within 180 s")), 180_000);
const started = performance.now();
session.receive(JSON.stringify({ type: "start", room: "check-ai", goal: "Call get_graph once, then reply with the single word OK.", graph: GRAPH, token: process.env.AI_TOKEN }));

const failures: string[] = [];
try {
  const result = await done.promise;
  process.stdout.write("\n");
  console.log(`model     ${ready ?? "(no ready frame)"} (wanted ${MODEL})`);
  console.log(`tools     ${tools?.join(" ") ?? "(no init message)"}`);
  console.log(`calls     ${calls.join(" ") || "(none)"}`);
  console.log(`result    ${result.isError ? "error" : "ok"}: ${result.message}`);
  console.log(`cost      $${result.cost.toFixed(4)}  turns ${result.turns}  ${((performance.now() - started) / 1000).toFixed(1)} s`);
  if (!ready) failures.push("no ready frame");
  if (JSON.stringify([...(tools ?? [])].sort()) !== JSON.stringify(expected)) failures.push(`tools differ from ${expected.join(" ")}`);
  if (!calls.includes("get_graph")) failures.push("get_graph was not called");
  if (result.isError) failures.push("the turn ended in an error");
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  clearTimeout(timeout);
  session.close();
}

if (failures.length) {
  console.error(`FAIL\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("PASS");
process.exit(0);
