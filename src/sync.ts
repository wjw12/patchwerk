// Mirrors the zustand graph into a Yjs room and back.
//
// The doc is flat so every field is its own last-writer-wins key:
//   nodes      id            -> { kind, label, x, y }
//   code       id            -> Y.Text (the shader draft; CodeMirror binds to it)
//   committed  id            -> last program that compiled and passed the test frame
//   params     "id/name"     -> number | [r, g, b]
//   edges      id            -> { source, target, targetHandle }
//
// Per-client state (selection, measured size, compile status) never leaves zustand.
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Edge } from "@xyflow/react";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { create } from "zustand";
import { engine } from "./engine/engine";
import { parseShader, type ShaderParam } from "./engine/wrap";
import { identity } from "./room";
import { mergeParams, useGraph, type GraphState, type NodeData, type PNode, type ShaderData } from "./store";

const LOCAL = Symbol("local");
const WIRE = "#8d7cff";

interface NodeRec {
  kind: NodeData["kind"];
  label: string;
  x: number;
  y: number;
}
interface EdgeRec {
  source: string;
  target: string;
  targetHandle: string;
}
type ParamValue = number | [number, number, number];

export interface Cursor {
  x: number;
  y: number;
  down: boolean;
}
export interface Peer {
  id: string;
  name: string;
  color: string;
  editing: string | null;
}
interface SyncState {
  room: string;
  status: "offline" | "connecting" | "connected";
  synced: boolean;
  peers: Peer[];
}

export const useSync = create<SyncState>(() => ({ room: "", status: "offline", synced: false, peers: [] }));

export const doc = new Y.Doc();
const nodesMap = doc.getMap<NodeRec>("nodes");
const codeMap = doc.getMap<Y.Text>("code");
const committedMap = doc.getMap<string>("committed");
const paramsMap = doc.getMap<ParamValue>("params");
const edgesMap = doc.getMap<EdgeRec>("edges");

let provider: HocuspocusProvider | null = null;
let ready = false;
let applying = false;
let pullQueued = false;

export function getCode(id: string): Y.Text | null {
  return codeMap.get(id) ?? null;
}

export function getAwareness(): Awareness | null {
  return provider?.awareness ?? null;
}

export function connect(room: string): void {
  if (provider) return;
  const url = import.meta.env.VITE_SYNC_URL ?? `ws://${location.hostname}:3000`;
  useSync.setState({ room, status: "connecting" });
  provider = new HocuspocusProvider({
    url,
    name: room,
    document: doc,
    onStatus: ({ status }) => useSync.setState({ status: status === "disconnected" ? "offline" : status }),
    onSynced: () => {
      if (ready) return;
      if (nodesMap.size === 0) seed(useGraph.getState());
      else pull();
      ready = true;
      useSync.setState({ synced: true });
    },
  });
  const awareness = provider.awareness;
  if (awareness) {
    const me = identity();
    awareness.setLocalStateField("user", { ...me, colorLight: `${me.color}55` });
    awareness.on("change", () => readPeers(awareness));
    engine.onPointer = (cursor) => publishCursor(awareness, cursor);
  }
  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL) schedulePull();
  });
  useGraph.subscribe(push);
}

// ---------------------------------------------------------------- local -> doc

function seed(state: GraphState): void {
  doc.transact(() => {
    for (const node of state.nodes) writeNode(node);
    for (const edge of state.edges) writeEdge(edge);
  }, LOCAL);
}

function push(state: GraphState, prev: GraphState): void {
  if (!ready || applying) return;
  if (state.nodes === prev.nodes && state.edges === prev.edges) return;
  doc.transact(() => {
    const before = new Map(prev.nodes.map((node) => [node.id, node]));
    const alive = new Set<string>();
    for (const node of state.nodes) {
      alive.add(node.id);
      if (before.get(node.id) !== node) writeNode(node);
    }
    for (const node of prev.nodes) if (!alive.has(node.id)) removeNode(node.id);

    const had = new Set(prev.edges.map((edge) => edge.id));
    const has = new Set(state.edges.map((edge) => edge.id));
    for (const edge of state.edges) if (!had.has(edge.id)) writeEdge(edge);
    for (const edge of prev.edges) if (!has.has(edge.id)) edgesMap.delete(edge.id);
  }, LOCAL);
}

/** Writes only the fields that differ from the doc, so a drag tick is one small key. */
function writeNode(node: PNode): void {
  const rec = nodesMap.get(node.id);
  const { x, y } = node.position;
  if (!rec || rec.kind !== node.data.kind || rec.label !== node.data.label || rec.x !== x || rec.y !== y) {
    nodesMap.set(node.id, { kind: node.data.kind, label: node.data.label, x, y });
  }
  if (node.data.kind !== "shader") return;
  const text = codeMap.get(node.id);
  if (!text) codeMap.set(node.id, new Y.Text(node.data.draft));
  else if (text.toString() !== node.data.draft) {
    text.delete(0, text.length);
    text.insert(0, node.data.draft);
  }
  if (node.data.committed && committedMap.get(node.id) !== node.data.committed) committedMap.set(node.id, node.data.committed);
  for (const param of node.data.params) {
    const key = `${node.id}/${param.name}`;
    if (!sameValue(paramsMap.get(key), param.value)) paramsMap.set(key, param.value);
  }
}

function removeNode(id: string): void {
  nodesMap.delete(id);
  codeMap.delete(id);
  committedMap.delete(id);
  for (const key of [...paramsMap.keys()]) if (key.startsWith(`${id}/`)) paramsMap.delete(key);
  edgesMap.forEach((edge, key) => {
    if (edge.source === id || edge.target === id) edgesMap.delete(key);
  });
}

function writeEdge(edge: Edge): void {
  if (edgesMap.has(edge.id)) return;
  edgesMap.set(edge.id, { source: edge.source, target: edge.target, targetHandle: edge.targetHandle ?? "ch0" });
}

// ---------------------------------------------------------------- doc -> local

function schedulePull(): void {
  if (pullQueued || !ready) return;
  pullQueued = true;
  queueMicrotask(() => {
    pullQueued = false;
    pull();
  });
}

function pull(): void {
  const state = useGraph.getState();
  const before = new Map(state.nodes.map((node) => [node.id, node]));
  const nodes: PNode[] = [];
  nodesMap.forEach((rec, id) => {
    const old = before.get(id);
    const next = buildNode(id, rec, old);
    nodes.push(old && sameNode(old, next) ? old : next);
  });
  nodes.sort((a, b) => (a.id < b.id ? -1 : 1));

  const edges = pruneEdges(nodes);
  applying = true;
  try {
    useGraph.setState({ nodes, edges });
  } finally {
    applying = false;
  }
}

function buildNode(id: string, rec: NodeRec, old: PNode | undefined): PNode {
  // Keep the local position while this client is mid-drag; the drop writes the final one.
  const position = old?.dragging ? old.position : { x: rec.x, y: rec.y };
  const base = { id, type: "top" as const, position, selected: old?.selected ?? false, measured: old?.measured };
  if (rec.kind !== "shader") return { ...base, data: { kind: rec.kind, family: "TOP", label: rec.label } };

  const draft = codeMap.get(id)?.toString() ?? "";
  const was = old?.data.kind === "shader" ? old.data : null;
  const parsed = was && was.draft === draft ? null : parseShader(draft);
  const schema = parsed ? mergeParams(was?.params ?? [], parsed.params) : (was?.params ?? []);
  const params = schema.map((param): ShaderParam => {
    const value = paramsMap.get(`${id}/${param.name}`);
    if (param.kind === "float" && typeof value === "number") return { ...param, value };
    if (param.kind === "color" && Array.isArray(value)) return { ...param, value };
    return param;
  });
  const data: ShaderData = {
    kind: "shader",
    family: "TOP",
    label: rec.label,
    draft,
    committed: committedMap.get(id) ?? was?.committed ?? null,
    status: was?.status ?? "idle",
    error: was?.error ?? null,
    channels: parsed ? parsed.channels : (was?.channels ?? []),
    feedback: parsed ? parsed.feedback : (was?.feedback ?? false),
    params,
  };
  return { ...base, data };
}

/**
 * Two clients can each make a locally valid wire that together form a cycle or
 * double up a channel. Every client prunes the same way and deletes the loser.
 */
function pruneEdges(nodes: PNode[]): Edge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const open = (node: PNode): number[] => (node.data.kind === "out" ? [0] : node.data.kind === "shader" ? node.data.channels : []);
  const kept: Edge[] = [];
  const taken = new Set<string>();
  const drop: string[] = [];
  const entries = [...edgesMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [id, rec] of entries) {
    const target = byId.get(rec.target);
    const channel = Number(rec.targetHandle.replace("ch", ""));
    const slot = `${rec.target}:${rec.targetHandle}`;
    const bad =
      !byId.has(rec.source) ||
      !target ||
      !open(target).includes(channel) ||
      taken.has(slot) ||
      reaches(rec.target, rec.source, kept);
    if (bad) {
      drop.push(id);
      continue;
    }
    taken.add(slot);
    kept.push({ id, source: rec.source, target: rec.target, sourceHandle: "out", targetHandle: rec.targetHandle, style: { stroke: WIRE, strokeWidth: 1.8 } });
  }
  if (drop.length) doc.transact(() => drop.forEach((id) => edgesMap.delete(id)), LOCAL);
  return kept;
}

function reaches(from: string, to: string, edges: Edge[]): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    if (id === to) return true;
    seen.add(id);
    for (const edge of edges) if (edge.source === id) stack.push(edge.target);
  }
  return false;
}

function sameNode(a: PNode, b: PNode): boolean {
  if (a.position.x !== b.position.x || a.position.y !== b.position.y || a.selected !== b.selected) return false;
  if (a.data.kind !== b.data.kind || a.data.label !== b.data.label) return false;
  if (a.data.kind !== "shader" || b.data.kind !== "shader") return true;
  if (a.data.draft !== b.data.draft || a.data.committed !== b.data.committed) return false;
  const theirs = b.data.params;
  if (a.data.params.length !== theirs.length) return false;
  return a.data.params.every((param, i) => {
    const other = theirs[i];
    return other !== undefined && param.name === other.name && sameValue(param.value, other.value);
  });
}

function sameValue(a: ParamValue | undefined, b: ParamValue): boolean {
  if (typeof a === "number" || typeof b === "number") return a === b;
  if (!a) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------- awareness

interface PeerState {
  user?: Peer;
  cursor?: Cursor | null;
  editing?: string | null;
}

let peerKey = "";

function readPeers(awareness: Awareness): void {
  const peers: Peer[] = [];
  const cursors: Cursor[] = [];
  awareness.getStates().forEach((raw, clientId) => {
    if (clientId === awareness.clientID) return;
    const state = raw as PeerState;
    if (!state.user) return;
    peers.push({ ...state.user, editing: state.editing ?? null });
    if (state.cursor) cursors.push(state.cursor);
  });
  engine.setRoomCursors(cursors);
  // Cursors move at pointer rate; only re-render React when membership or focus changes.
  const key = peers.map((peer) => `${peer.id}:${peer.editing ?? ""}`).join("|");
  if (key !== peerKey) {
    peerKey = key;
    useSync.setState({ peers });
  }
}

let cursorPending: Cursor | null = null;

function publishCursor(awareness: Awareness, cursor: Cursor): void {
  const idle = cursorPending === null;
  cursorPending = cursor;
  if (!idle) return;
  requestAnimationFrame(() => {
    awareness.setLocalStateField("cursor", cursorPending);
    cursorPending = null;
  });
}

export function setEditing(id: string | null): void {
  getAwareness()?.setLocalStateField("editing", id);
}
