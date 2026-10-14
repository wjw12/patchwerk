import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer, query, tool, type Query, type SDKMessage, type SDKResultError, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { catalogText } from "../src/ops/catalog";
import type { ClientFrame, Content, ServerFrame, ToolName } from "../src/ai/protocol";

export const MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";
const BUDGET_USD = Number(process.env.AI_BUDGET_USD ?? 3);
const TOKEN = process.env.AI_TOKEN;
const MAX_SESSIONS = 4;
const RPC_TIMEOUT_MS = 20_000;
const TOOL_TIMEOUT_MS = 120_000;
const MAX_TURNS = 60;

const SYSTEM = (await Bun.file(new URL("./prompt.txt", import.meta.url)).text()).replace("{{catalog}}", catalogText());

const node = z.string().describe("a node label (preferred) or id");

type Answer = { content: Content[]; isError?: boolean };
type Call = (name: ToolName, input: Record<string, unknown>) => Promise<Answer>;

function patchwerkTools(call: Call) {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      "get_graph",
      "The whole patch as text: every node with family, type, status, error and parameters (expressions with their current value), every wire, who else is in the room and what they are editing, and the mic state. Call this first, and again after a sequence of edits to confirm the state.",
      {},
      (input) => call("get_graph", input),
      readOnly,
    ),
    tool(
      "read_shader",
      "The GLSL source of a shader TOP with line numbers, its compile status and error, and the parameters parsed from its annotations.",
      { node },
      (input) => call("read_shader", input),
      readOnly,
    ),
    tool(
      "write_shader",
      "Replace the whole GLSL body of a shader TOP and compile it. Returns `live` or the compiler errors with line numbers of your source. Write the complete file, not a patch: ShaderToy mainImage style, no #version, no main(). A program must pass a test frame (no NaN, not solid black, not a single flat color); a failing program is kept as the draft while the last good program keeps rendering. Inputs follow the code: an iChannelN the new code does not read loses its wire immediately, even if the compile fails, and the result lists any wire that was dropped.",
      { node, code: z.string().describe("the complete shader source") },
      (input) => call("write_shader", input),
    ),
    tool(
      "set_param",
      "Set one parameter on one node. A number sets a constant; `{expr}` makes the parameter cook from an expression every frame; a string picks a menu option or sets a name parameter (geo.pop, geo.mat, render.geometry, render.camera, render.lights, feedback.top); `#rrggbb` sets a color uniform. Values outside the slider range are accepted and flagged. Integer parameters are rounded.",
      {
        node,
        name: z.string().describe('par name as printed by get_graph, e.g. "fov", "uDecay", "iChannel0.wrap"'),
        value: z.union([z.number(), z.string(), z.object({ expr: z.string() })]),
      },
      (input) => call("set_param", input),
    ),
    tool(
      "add_node",
      "Add an operator and return the label actually assigned (labels are made unique, so `noise` may become `noise1`). If `after` is given, the new node is spliced in after it: after.out feeds the new node's first inlet, and whatever after.out used to feed is now fed by the new node, so inserting an effect before `out` is one call. For a shader TOP pass `code` so it has an inlet (the template has none); the code is compiled before wiring and compile errors are returned the same way as write_shader.",
      {
        family: z.enum(["TOP", "CHOP", "POP", "MAT", "COMP"]),
        type: z.string().describe('an operator type from the catalog, plus TOP "shader" | "audio" | "out"'),
        label: z.string().optional().describe("wanted label; made unique"),
        after: z.string().optional().describe("same-family node to splice this one after"),
        code: z.string().optional().describe("shader TOP only: the complete shader source"),
      },
      (input) => call("add_node", input),
    ),
    tool(
      "connect",
      "Wire source.out into target.inlet. Both nodes must be in the same family, the inlet must exist and be free, and the wire must not close a loop (use `// @feedback` or `// @prev` in a shader for feedback). Returns the reason when the wire is refused.",
      { source: node, target: node, inlet: z.string().describe('e.g. "ch0" on a shader TOP or "in0" on an op') },
      (input) => call("connect", input),
    ),
    tool(
      "disconnect",
      "Remove the wire feeding target.inlet.",
      { target: node, inlet: z.string() },
      (input) => call("disconnect", input),
    ),
    tool(
      "edit_node",
      "Rename, bypass or delete a node. Renaming follows expressions and geo/render name parameters, but not `// @prev` lines in shader code. Deleting removes the node's wires too. Bypass passes a TOP's ch0 through (a shader with no ch0 goes black), makes render output nothing, and makes a generator CHOP output 0; use it for A/B checks, not as a mute.",
      { node, label: z.string().optional(), bypass: z.boolean().optional(), delete: z.boolean().optional() },
      (input) => call("edit_node", input),
    ),
    tool(
      "view",
      "Look at a node's output as an image. Default is the final picture (`out`). `frames` > 1 returns that many captures spaced `interval_ms` apart so you can judge motion. CHOP nodes return samples over that span as numbers instead of an image. Each image comes with a stat line (mean brightness, fraction of black pixels, NaN count) so you can catch an all-black or broken frame without guessing.",
      {
        node: node.optional().describe("default out"),
        frames: z.number().int().min(1).max(4).optional().describe("1 to 4, default 1"),
        interval_ms: z.number().min(100).max(2000).optional().describe("default 400"),
      },
      (input) => call("view", input),
      readOnly,
    ),
  ];
}

export function startAgent(prompt: AsyncIterable<SDKUserMessage>, call: Call, abortController: AbortController, cwd: string): Query {
  return query({
    prompt,
    options: {
      model: MODEL,
      systemPrompt: SYSTEM,
      tools: [],
      mcpServers: {
        patchwerk: createSdkMcpServer({ name: "patchwerk", version: "1.0.0", tools: patchwerkTools(call), alwaysLoad: true, timeout: TOOL_TIMEOUT_MS }),
      },
      allowedTools: ["mcp__patchwerk__*"],
      permissionMode: "dontAsk",
      settingSources: [],
      cwd,
      env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
      persistSession: false,
      includePartialMessages: true,
      maxTurns: MAX_TURNS,
      maxBudgetUsd: BUDGET_USD,
      abortController,
    },
  });
}

class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;

  push(text: string): void {
    this.queue.push({ type: "user", parent_tool_use_id: null, message: { role: "user", content: text } });
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const next = this.queue.shift();
      if (next) yield next;
      else if (this.closed) return;
      else await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}

export interface Peer {
  send(data: string): unknown;
  close(): void;
}

interface Pending {
  resolve: (result: Answer) => void;
  reject: (error: Error) => void;
  timer: Timer;
}

const rooms = new Map<string, Session>();
const live = new Set<Session>();

export function aiStatus(): { sessions: number; model: string } {
  return { sessions: live.size, model: MODEL };
}

function isContent(block: unknown): block is Content {
  if (typeof block !== "object" || block === null) return false;
  const b = block as Record<string, unknown>;
  if (b.type === "text") return typeof b.text === "string";
  return b.type === "image" && typeof b.data === "string" && b.mimeType === "image/png";
}

export class Session {
  private readonly pending = new Map<string, Pending>();
  private readonly inbox = new Inbox();
  private readonly abort = new AbortController();
  private agent?: Query;
  private room?: string;
  private cwd?: string;
  private nextId = 0;
  private line: Promise<unknown> = Promise.resolve();
  private closed = false;
  private announced = false;
  private stopping = false;

  constructor(
    private readonly peer: Peer,
    private readonly observe?: (message: SDKMessage) => void,
  ) {}

  receive(data: string): void {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof frame !== "object" || frame === null) return;
    switch (frame.type) {
      case "start":
        void this.start(frame.room, frame.goal, frame.graph, frame.token);
        break;
      case "user":
        if (!this.agent) return this.send({ type: "error", message: "send start before user" });
        this.stopping = false;
        this.inbox.push(`${frame.text}\n\nRoom now:\n${frame.graph}`);
        break;
      case "result":
        this.settle(frame.id, { content: Array.isArray(frame.content) ? frame.content.filter(isContent) : [], isError: frame.isError });
        break;
      case "stop":
        if (!this.agent) break;
        this.stopping = true;
        this.agent.interrupt().catch(() => {});
        break;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.inbox.close();
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("the browser disconnected"));
    }
    this.pending.clear();
    this.release();
  }

  private async start(room: string, goal: string, graph: string, token?: string): Promise<void> {
    if (this.agent || this.room) return this.send({ type: "error", message: "this session has already started; send user frames" });
    if (TOKEN && token !== TOKEN) return this.fail("wrong or missing token");
    if (typeof room !== "string" || !room) return this.fail("start needs a room");
    if (rooms.has(room)) return this.fail("claude is already working in this room");
    if (live.size >= MAX_SESSIONS) return this.fail(`claude is already working in ${MAX_SESSIONS} rooms; try again later`);
    this.room = room;
    rooms.set(room, this);
    live.add(this);
    try {
      this.cwd = await mkdtemp(join(tmpdir(), "patchwerk-ai-"));
      if (this.closed) return;
      this.agent = startAgent(this.inbox, (name, input) => this.rpc(name, input), this.abort, this.cwd);
      this.inbox.push(`Goal: ${goal}\n\nRoom now:\n${graph}`);
      for await (const message of this.agent) this.forward(message);
      if (!this.closed) this.fail("the agent session ended");
    } catch (error) {
      if (!this.closed) this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.release();
    }
  }

  private forward(message: SDKMessage): void {
    this.observe?.(message);
    if (message.type === "system" && message.subtype === "init") {
      if (!this.announced) this.send({ type: "ready", model: message.model });
      this.announced = true;
    } else if (message.type === "stream_event" && message.parent_tool_use_id === null) {
      const event = message.event;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") this.send({ type: "text", text: event.delta.text });
    } else if (message.type === "result") {
      const stopped = this.stopping;
      this.stopping = false;
      this.send({
        type: "done",
        cost: message.total_cost_usd,
        turns: message.num_turns,
        isError: message.is_error || message.subtype !== "success",
        message: message.subtype === "success" ? message.result : stopped ? "stopped" : this.why(message),
      });
    }
  }

  private why(message: SDKResultError): string {
    if (message.subtype === "error_max_turns") return `stopped after ${MAX_TURNS} turns; send a follow-up to continue`;
    if (message.subtype === "error_max_budget_usd") return `stopped: this session's $${BUDGET_USD} budget is spent; clear to start a new one`;
    return message.errors[0] ?? message.subtype;
  }

  private rpc(name: ToolName, input: Record<string, unknown>): Promise<Answer> {
    const turn = this.line.then(() => this.dispatch(name, input));
    this.line = turn.catch(() => {});
    return turn;
  }

  private dispatch(name: ToolName, input: Record<string, unknown>): Promise<Answer> {
    if (this.closed) return Promise.reject(new Error("the browser disconnected"));
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(id, {
          content: [{ type: "text", text: `the browser did not answer ${name} within ${RPC_TIMEOUT_MS / 1000} s; the tab may be busy or gone` }],
          isError: true,
        });
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ type: "tool_call", id, name, input });
    });
  }

  private settle(id: string, result: Answer): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(result);
  }

  private send(frame: ServerFrame): void {
    if (!this.closed) this.peer.send(JSON.stringify(frame));
  }

  private fail(message: string): void {
    this.send({ type: "error", message });
    this.peer.close();
    this.close();
  }

  private release(): void {
    if (this.room && rooms.get(this.room) === this) rooms.delete(this.room);
    live.delete(this);
    if (this.cwd) rmSync(this.cwd, { recursive: true, force: true });
    this.cwd = undefined;
  }
}

const sessions = new WeakMap<Peer, Session>();

export const aiSocket = {
  open(ws: Peer): void {
    sessions.set(ws, new Session(ws));
  },
  message(ws: Peer, message: string | Buffer): void {
    sessions.get(ws)?.receive(typeof message === "string" ? message : message.toString("utf8"));
  },
  close(ws: Peer): void {
    sessions.get(ws)?.close();
    sessions.delete(ws);
  },
};
