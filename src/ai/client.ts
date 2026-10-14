import { create } from "zustand";
import { setAgent, useSync } from "../sync";
import { graphText, runTool } from "./execute";
import type { ClientFrame, ServerFrame, ToolName, ToolResult } from "./protocol";

export type ToolEntry = {
  kind: "tool";
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
  result: string;
  images: string[];
  isError: boolean;
  pending: boolean;
};

export type Entry =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | ToolEntry
  | { kind: "done"; cost: number; turns: number; isError: boolean; message: string }
  | { kind: "error"; message: string };

export type Status = "idle" | "connecting" | "running" | "error";

interface AssistantState {
  status: Status;
  transcript: Entry[];
  cost: number;
  model: string | null;
  error: string | null;
  start(goal: string): Promise<void>;
  send(text: string): Promise<void>;
  stop(): void;
  clear(): void;
}

export const useAssistant = create<AssistantState>(() => ({
  status: "idle",
  transcript: [],
  cost: 0,
  model: null,
  error: null,
  start,
  send,
  stop,
  clear,
}));

let socket: WebSocket | null = null;
let opening: Promise<WebSocket | null> | null = null;
let session = false;
let spent = 0;
let sessionCost = 0;
let queue: Promise<void> = Promise.resolve();

function aiUrl(): string {
  const sync: string | undefined = import.meta.env.VITE_SYNC_URL;
  if (sync) {
    const url = new URL(sync);
    url.pathname = "/ai";
    url.search = "";
    return url.href;
  }
  if (location.protocol === "https:") return `wss://${location.host}/ai`;
  return `ws://${location.hostname}:3000/ai`;
}

function busy(): boolean {
  const { status } = useAssistant.getState();
  return status === "connecting" || status === "running";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function append(entry: Entry): void {
  useAssistant.setState(({ transcript }) => ({ transcript: [...transcript, entry] }));
}

function finish(status: "idle" | "error", error: string | null = null): void {
  useAssistant.setState({ status, error });
  setAgent(false);
}

function fail(message: string): void {
  append({ kind: "error", message });
  finish("error", message);
}

function drop(): void {
  const ws = socket;
  socket = null;
  opening = null;
  session = false;
  ws?.close();
}

function open(): Promise<WebSocket | null> {
  if (opening) return opening;
  const ws = new WebSocket(aiUrl());
  socket = ws;
  session = false;
  spent = useAssistant.getState().cost;
  sessionCost = 0;
  let opened = false;
  opening = new Promise((resolve) => {
    ws.onopen = () => {
      opened = true;
      resolve(ws);
    };
    ws.onclose = () => {
      resolve(null);
      if (socket !== ws) return;
      socket = null;
      opening = null;
      session = false;
      if (busy()) fail(opened ? "the connection to the assistant closed" : `could not reach the assistant at ${ws.url}`);
    };
  });
  ws.onmessage = (event) => {
    if (socket === ws) receive(ws, JSON.parse(String(event.data)) as ServerFrame);
  };
  return opening;
}

function transmit(ws: WebSocket, frame: ClientFrame): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function receive(ws: WebSocket, frame: ServerFrame): void {
  if (frame.type === "ready") useAssistant.setState({ model: frame.model });
  else if (frame.type === "text") stream(frame.text);
  else if (frame.type === "tool_call") {
    const { id, name, input } = frame;
    queue = queue.then(() => call(ws, id, name, input));
  } else if (frame.type === "done") {
    append({ kind: "done", cost: frame.cost - sessionCost, turns: frame.turns, isError: frame.isError ?? false, message: frame.message ?? "" });
    sessionCost = frame.cost;
    useAssistant.setState({ cost: spent + frame.cost });
    finish("idle");
  } else {
    fail(frame.message);
    drop();
  }
}

function stream(text: string): void {
  useAssistant.setState(({ transcript }) => {
    const last = transcript[transcript.length - 1];
    if (last?.kind === "text") return { transcript: [...transcript.slice(0, -1), { kind: "text", text: last.text + text }] };
    return { transcript: [...transcript, { kind: "text", text }] };
  });
}

async function call(ws: WebSocket, id: string, name: ToolName, input: Record<string, unknown>): Promise<void> {
  if (socket !== ws) return;
  append({ kind: "tool", id, name, input, result: "", images: [], isError: false, pending: true });
  const result = await run(name, input);
  const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  const images = result.content.flatMap((block) => (block.type === "image" ? [block.data] : []));
  useAssistant.setState(({ transcript }) => ({
    transcript: transcript.map((entry) =>
      entry.kind === "tool" && entry.id === id ? { ...entry, result: text, images, isError: result.isError ?? false, pending: false } : entry,
    ),
  }));
  transmit(ws, { type: "result", id, content: result.content, isError: result.isError });
}

async function run(name: ToolName, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    return await runTool(name, input);
  } catch (error) {
    return { content: [{ type: "text", text: describe(error) }], isError: true };
  }
}

function snapshot(): string | null {
  try {
    return graphText();
  } catch (error) {
    fail(`could not read the graph: ${describe(error)}`);
    return null;
  }
}

async function start(goal: string): Promise<void> {
  const text = goal.trim();
  if (!text || busy()) return;
  drop();
  append({ kind: "user", text });
  useAssistant.setState({ status: "connecting", error: null });
  setAgent(true);
  const ws = await open();
  if (!ws || socket !== ws || useAssistant.getState().status !== "connecting") return;
  const graph = snapshot();
  if (graph === null) return;
  session = true;
  transmit(ws, { type: "start", room: useSync.getState().room, goal: text, graph });
  useAssistant.setState({ status: "running" });
}

async function send(input: string): Promise<void> {
  const text = input.trim();
  if (!text || busy()) return;
  const ws = socket;
  if (!session || !ws || ws.readyState !== WebSocket.OPEN) return start(text);
  append({ kind: "user", text });
  const graph = snapshot();
  if (graph === null) return;
  useAssistant.setState({ status: "running", error: null });
  setAgent(true);
  transmit(ws, { type: "user", text, graph });
}

function stop(): void {
  const { status } = useAssistant.getState();
  if (status === "connecting") {
    drop();
    finish("idle");
  } else if (status === "running" && socket) transmit(socket, { type: "stop" });
}

function clear(): void {
  drop();
  spent = 0;
  sessionCost = 0;
  useAssistant.setState({ status: "idle", transcript: [], cost: 0, error: null });
  setAgent(false);
}
