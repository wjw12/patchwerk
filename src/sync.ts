// Mirrors the zustand graph into a Yjs room and back.
//
// The doc is flat so every field is its own last-writer-wins key:
//   nodes      id            -> { kind, label, x, y }
//   code       id            -> Y.Text (the shader draft; CodeMirror binds to it)
//   committed  id            -> last program that compiled and passed the test frame
//   params     "id/name"     -> number | [r, g, b] | encoded par string
//   edges      id            -> { source, target, targetHandle }
//
// Per-client state (selection, measured size, compile status) never leaves zustand.
//
// The room doc is cached in IndexedDB, so a room this browser has seen opens and edits
// with the server down, and the edits merge when it is back. A room it has never seen
// can't be seeded offline (the seed would merge into whatever the server holds), so it is
// edited in a scratch doc until the server answers. See `settle` and `adoptRoom`.
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Edge } from "@xyflow/react";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { create } from "zustand";
import { engine } from "./engine/engine";
import { decodeShaderParam, encodeShaderParam, parseShader } from "./engine/wrap";
import { toGraphFile, type GraphFile } from "./graph-file";
import { identity } from "./room";
import { wireStyle, type Family } from "./family";
import { createOpData, migrateLegacyRenders, type OpData, type Par } from "./ops/catalog";
import { keepsWire, mergeParams, nodeOutlet, uniqueLabel, useGraph, type GraphState, type NodeData, type PNode, type ShaderData } from "./store";

/** This client's graph edits. The only origin the undo manager records. */
const LOCAL = Symbol("local");
/** This client's bookkeeping writes: seeding a room, dropping a losing wire. Never undone. */
const QUIET = Symbol("quiet");

interface NodeRec {
  kind: NodeData["kind"];
  family?: Family;
  type?: string;
  label: string;
  x: number;
  y: number;
  bypass?: boolean;
}
interface EdgeRec {
  source: string;
  target: string;
  targetHandle: string;
}
type ParamValue = number | [number, number, number] | string;

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
  agent?: boolean;
}
/**
 * waiting: nothing to edit against yet (the graph still runs, edits stay in this tab).
 * room: the graph mirrors the room doc; offline edits are cached in this browser and merge later.
 * local: the server never answered and this browser has no copy of the room; a scratch doc.
 */
export type SyncMode = "waiting" | "room" | "local";

/** The server came back with its own graph after this tab edited a scratch copy. */
export interface Diverged {
  graph: GraphFile;
}

interface SyncState {
  room: string;
  status: "offline" | "connecting" | "connected";
  /** The server's copy has arrived on the current connection. */
  synced: boolean;
  mode: SyncMode;
  /** Bumped whenever the graph moves to another doc, so shader editors rebind. */
  epoch: number;
  diverged: Diverged | null;
  peers: Peer[];
}

export const useSync = create<SyncState>(() => ({
  room: "",
  status: "offline",
  synced: false,
  mode: "waiting",
  epoch: 0,
  diverged: null,
  peers: [],
}));

/** The room as the server and this browser's cache know it. The provider syncs it. */
const roomDoc = new Y.Doc();
/** The doc the graph mirrors: the room doc, or a scratch doc in local mode. */
let doc = roomDoc;
let nodesMap: Y.Map<NodeRec>;
let codeMap: Y.Map<Y.Text>;
let committedMap: Y.Map<string>;
let paramsMap: Y.Map<ParamValue>;
let edgesMap: Y.Map<EdgeRec>;
/** `loaded` changes when someone replaces the whole graph, so every client re-fits its view. */
let metaMap: Y.Map<string>;

let provider: HocuspocusProvider | null = null;
let ready = false;
let applying = false;
let pullQueued = false;
/** Something other than the seed was written to the scratch doc. */
let editedLocally = false;

// ---------------------------------------------------------------- undo
//
// Undo walks back this client's own graph edits only; someone else's edits are never
// undone. Shader text is not in here: CodeMirror keeps its own text undo. `committed` is
// left out so a compile is never an undo step.

const GESTURE_GAP = 400;
let history: Y.UndoManager;

export const useHistory = create<{ canUndo: boolean; canRedo: boolean }>(() => ({ canUndo: false, canRedo: false }));
const readHistory = () => useHistory.setState({ canUndo: history.canUndo(), canRedo: history.canRedo() });

const watched = new WeakSet<Y.Doc>();

/** Points the mirror (maps, undo) at another doc. Undo history does not carry over. */
function bind(next: Y.Doc): void {
  history?.destroy();
  doc = next;
  if (!watched.has(next)) {
    watched.add(next);
    // Someone else's edit, an undo, or a shader keystroke: bring the store up to date.
    next.on("update", (_update: Uint8Array, origin: unknown) => {
      if (doc === next && origin !== LOCAL && origin !== QUIET) schedulePull();
    });
  }
  nodesMap = next.getMap<NodeRec>("nodes");
  codeMap = next.getMap<Y.Text>("code");
  committedMap = next.getMap<string>("committed");
  paramsMap = next.getMap<ParamValue>("params");
  edgesMap = next.getMap<EdgeRec>("edges");
  metaMap = next.getMap<string>("meta");
  history = new Y.UndoManager([nodesMap, codeMap, paramsMap, edgesMap], {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout: GESTURE_GAP,
  });
  history.on("stack-item-added", readHistory);
  history.on("stack-item-popped", readHistory);
  history.on("stack-cleared", readHistory);
  readHistory();
  useSync.setState(({ epoch }) => ({ epoch: epoch + 1 }));
}

bind(roomDoc);

export function undo(): void {
  if (ready) history.undo();
}

export function redo(): void {
  if (ready) history.redo();
}

/**
 * A pointer gesture (node drag, slider scrub, wire drag) is one undo step however long it
 * takes. The release is deferred a tick so the drop's final write still joins the gesture.
 */
export function beginGesture(): void {
  history.stopCapturing();
  history.captureTimeout = Number.POSITIVE_INFINITY;
}

export function endGesture(): void {
  window.setTimeout(() => {
    history.captureTimeout = GESTURE_GAP;
  }, 0);
}

/** The next edit starts a new undo step. */
export function breakUndo(): void {
  history.stopCapturing();
}

/**
 * Replaces the whole graph (import, example, load, reset). In a room it is one transaction
 * that empties every map first, so nothing of the old graph lingers under a reused id, and
 * one undo step brings the old graph back.
 */
export function replaceGraph(nodes: PNode[], edges: Edge[]): void {
  if (!ready) {
    // Before the first sync, or in a fixed session: only this tab's graph changes.
    localCode.clear();
    useGraph.getState().replace(nodes, edges);
    useGraph.getState().requestFit();
    return;
  }
  history.stopCapturing();
  doc.transact(() => {
    nodesMap.clear();
    codeMap.clear();
    committedMap.clear();
    paramsMap.clear();
    edgesMap.clear();
    for (const node of nodes) writeNode(node);
    for (const edge of edges) writeEdge(edge);
  }, LOCAL);
  history.stopCapturing();
  const loaded = crypto.randomUUID();
  lastLoaded = loaded;
  doc.transact(() => metaMap.set("loaded", loaded), QUIET);
  applying = true;
  try {
    useGraph.getState().replace(nodes, edges);
  } finally {
    applying = false;
  }
  useGraph.getState().requestFit();
}

let lastLoaded: string | undefined;

export function getCode(id: string): Y.Text | null {
  return codeMap.get(id) ?? null;
}

// Fixed sessions (?graph=, ?t=, ?frame=) never join a room. Their editor binds to a
// local, unsynced text that writes each edit straight back into the store.
const localDoc = new Y.Doc();
const localCode = localDoc.getMap<Y.Text>("code");

export function getLocalCode(id: string, draft: string): Y.Text {
  const existing = localCode.get(id);
  if (existing) return existing;
  const text = new Y.Text(draft);
  localCode.set(id, text);
  text.observe(() => useGraph.getState().updateDraft(id, text.toString()));
  return text;
}

export function getAwareness(): Awareness | null {
  return provider?.awareness ?? null;
}

/**
 * Served over HTTPS (the deployed site), the room server sits behind the same host at /sync.
 * Over plain HTTP (vite dev, phones on the LAN) it is the dev server on port 3000.
 */
function defaultSyncUrl(): string {
  if (location.protocol === "https:") return `wss://${location.host}/sync`;
  return `ws://${location.hostname}:3000`;
}

/** How long a first connection may take before this tab stops waiting and works offline. */
const OFFLINE_AFTER = 4000;

let serverSynced = false;
let serverDown = false;
let cacheDone = false;

export function connect(room: string): void {
  if (provider) return;
  const url = import.meta.env.VITE_SYNC_URL || defaultSyncUrl();
  useSync.setState({ room, status: "connecting" });
  try {
    const cache = new IndexeddbPersistence(`patchwerk.room.${room}`, roomDoc);
    void cache.whenSynced.then(() => {
      cacheDone = true;
      settle();
    });
  } catch {
    // no IndexedDB (blocked storage): the room lives on the server only
    cacheDone = true;
  }
  provider = new HocuspocusProvider({
    url,
    name: room,
    document: roomDoc,
    onStatus: ({ status }) => {
      useSync.setState({ status: status === "disconnected" ? "offline" : status });
      if (status !== "disconnected") return;
      serverSynced = false;
      serverDown = true;
      useSync.setState({ synced: false });
      settle();
    },
    onSynced: () => {
      serverSynced = true;
      useSync.setState({ synced: true });
      if (useSync.getState().mode === "local") adoptRoom();
      else settle();
    },
  });
  window.setTimeout(() => {
    serverDown = true;
    cacheDone = true;
    settle();
  }, OFFLINE_AFTER);
  const awareness = provider.awareness;
  if (awareness) {
    const me = identity();
    awareness.setLocalStateField("user", { ...me, colorLight: `${me.color}55` });
    awareness.on("change", () => readPeers(awareness));
    engine.onPointer = (cursor) => publishCursor(awareness, cursor);
  }
  useGraph.subscribe(push);
}

/**
 * Until the first doc is chosen the graph runs in this tab only. The server's copy wins;
 * without it, this browser's cached copy of the room; without that, once the server has
 * failed to answer, a scratch doc.
 */
function settle(): void {
  if (ready) return;
  const cached = cacheDone && nodesMap.size > 0;
  if (serverSynced || cached) {
    if (nodesMap.size === 0) seed(useGraph.getState());
    else {
      // The room's graph replaces the local one; fit the view to it.
      lastLoaded = "(before the first sync)";
      pull();
    }
    ready = true;
    useSync.setState({ mode: "room" });
  } else if (cacheDone && serverDown) {
    const scratch = new Y.Doc();
    bind(scratch);
    seed(useGraph.getState());
    // A compile landing in `committed` is not an edit of the patch.
    scratch.on("afterTransaction", (transaction: Y.Transaction) => {
      if (transaction.origin === QUIET) return;
      for (const type of transaction.changed.keys()) if (type !== (committedMap as unknown)) editedLocally = true;
    });
    ready = true;
    useSync.setState({ mode: "local" });
  }
}

/**
 * The server answered after this tab started on a scratch doc. An empty room takes the
 * scratch graph, edits and all. A room with its own graph wins; if this tab had changed
 * the scratch copy, that copy is offered as a new room instead of being merged in.
 */
function adoptRoom(): void {
  const scratch = doc;
  const roomNodes = roomDoc.getMap<NodeRec>("nodes");
  if (roomNodes.size === 0) {
    Y.applyUpdate(roomDoc, Y.encodeStateAsUpdate(scratch), QUIET);
    bind(roomDoc);
  } else {
    const { nodes, edges } = useGraph.getState();
    const mine = editedLocally ? toGraphFile(nodes, edges) : null;
    bind(roomDoc);
    lastLoaded = "(adopting the room)";
    pull();
    if (mine) useSync.setState({ diverged: { graph: mine } });
  }
  scratch.destroy();
  editedLocally = false;
  useSync.setState({ mode: "room" });
}

export function dismissDiverged(): void {
  useSync.setState({ diverged: null });
}

// ---------------------------------------------------------------- local -> doc

function seed(state: GraphState): void {
  doc.transact(() => {
    for (const node of state.nodes) writeNode(node);
    for (const edge of state.edges) writeEdge(edge);
  }, QUIET);
}

/** Nodes this tab added, so a label clash is fixed by the tab that made the clashing node. */
const added = new Set<string>();

function push(state: GraphState, prev: GraphState): void {
  if (!ready || applying) return;
  if (state.nodes === prev.nodes && state.edges === prev.edges) return;
  doc.transact(() => {
    const before = new Map(prev.nodes.map((node) => [node.id, node]));
    const alive = new Set<string>();
    for (const node of state.nodes) {
      alive.add(node.id);
      if (!before.has(node.id)) added.add(node.id);
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
  const next: NodeRec = {
    kind: node.data.kind,
    family: node.data.family,
    type: node.data.kind === "op" ? node.data.type : undefined,
    label: node.data.label,
    x,
    y,
    bypass: node.data.bypass,
  };
  if (
    !rec ||
    rec.kind !== next.kind ||
    rec.family !== next.family ||
    rec.type !== next.type ||
    rec.label !== next.label ||
    rec.x !== x ||
    rec.y !== y ||
    rec.bypass !== next.bypass
  ) {
    nodesMap.set(node.id, next);
  }
  if (node.data.kind === "op") {
    for (const par of node.data.pars) {
      const key = `${node.id}/${par.name}`;
      const encoded = encodeOpPar(par);
      if (paramsMap.get(key) !== encoded) paramsMap.set(key, encoded);
    }
    return;
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
    const encoded = encodeShaderParam(param);
    if (!sameValue(paramsMap.get(key), encoded)) paramsMap.set(key, encoded);
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
  // Someone replaced the whole graph: a reused id is a new node, nothing carries over.
  const loaded = metaMap.get("loaded");
  const reloaded = loaded !== lastLoaded;
  if (reloaded) {
    lastLoaded = loaded;
    before.clear();
  }
  const built: PNode[] = [];
  nodesMap.forEach((rec, id) => {
    built.push(buildNode(id, rec, before.get(id)));
  });
  migrateLegacyRenders(built, storedText);
  const nodes = built.map((next) => {
    const old = before.get(next.id);
    return old && sameNode(old, next) ? old : next;
  });
  nodes.sort((a, b) => (a.id < b.id ? -1 : 1));
  relabelClashes(nodes);

  const edges = pruneEdges(nodes);
  applying = true;
  try {
    useGraph.setState({ nodes, edges });
  } finally {
    applying = false;
  }
  if (reloaded) useGraph.getState().requestFit();
}

/**
 * Two tabs adding a noise at the same moment both pick "noise1". Labels are how op('…') and
 * geo/render find a node, so the node with the later id gets the next free label, written
 * once by the tab that added it. It is a local edit so it undoes along with the add.
 */
function relabelClashes(nodes: PNode[]): void {
  const seen = new Set<string>();
  const fixes: [number, string][] = [];
  nodes.forEach((node, index) => {
    const label = node.data.label;
    if (!seen.has(label)) {
      seen.add(label);
      return;
    }
    if (!added.has(node.id)) return;
    const next = uniqueLabel(label, nodes.filter((other) => other.id !== node.id));
    seen.add(next);
    fixes.push([index, next]);
    nodes[index] = { ...node, data: { ...node.data, label: next } };
  });
  if (fixes.length === 0) return;
  doc.transact(() => {
    for (const [index, label] of fixes) {
      const id = nodes[index]!.id;
      const rec = nodesMap.get(id);
      if (rec) nodesMap.set(id, { ...rec, label });
    }
  }, LOCAL);
}

function familyOf(rec: NodeRec): Family {
  if (rec.family === "POP" || rec.family === "CHOP" || rec.family === "TOP" || rec.family === "MAT" || rec.family === "COMP") return rec.family;
  return "TOP";
}

function encodeOpPar(par: Par): string {
  if (par.kind === "number") return `n:${par.mode}:${par.value}:${encodeURIComponent(par.expr)}`;
  if (par.kind === "menu") return `m:${encodeURIComponent(par.value)}`;
  return `t:${encodeURIComponent(par.value)}`;
}

function storedText(id: string, name: string): string | null {
  const raw = paramsMap.get(`${id}/${name}`);
  if (typeof raw !== "string" || !raw.startsWith("t:")) return null;
  return decodeURIComponent(raw.slice(2));
}

function decodePars(pars: Par[], id: string): Par[] {
  return pars.map((par) => {
    const raw = paramsMap.get(`${id}/${par.name}`);
    if (typeof raw !== "string") return par;
    if (raw.startsWith("n:") && par.kind === "number") {
      const body = raw.slice(2);
      const modeEnd = body.indexOf(":");
      const rest = body.slice(modeEnd + 1);
      const valueEnd = rest.indexOf(":");
      const value = Number(rest.slice(0, valueEnd));
      return {
        ...par,
        mode: body.slice(0, modeEnd) === "expression" ? "expression" : "constant",
        value: Number.isFinite(value) ? value : par.value,
        expr: decodeURIComponent(rest.slice(valueEnd + 1)),
      };
    }
    if (raw.startsWith("m:") && par.kind === "menu") {
      const value = decodeURIComponent(raw.slice(2));
      return par.options.includes(value) ? { ...par, value } : par;
    }
    if (raw.startsWith("t:") && par.kind === "text") return { ...par, value: decodeURIComponent(raw.slice(2)) };
    return par;
  });
}

function buildNode(id: string, rec: NodeRec, old: PNode | undefined): PNode {
  // Keep the local position while this client is mid-drag; the drop writes the final one.
  const position = old?.dragging ? old.position : { x: rec.x, y: rec.y };
  const base = { id, type: "top" as const, position, selected: old?.selected ?? false, measured: old?.measured };
  if (rec.kind === "op" && rec.type) {
    let data: OpData;
    try {
      data = createOpData(familyOf(rec), rec.type, rec.label);
    } catch {
      return { ...base, data: { kind: "out", family: "TOP", label: rec.label, bypass: false } };
    }
    data.bypass = rec.bypass ?? false;
    data.pars = decodePars(data.pars, id);
    if (old?.data.kind === "op" && old.data.type === rec.type) {
      data.status = old.data.status;
      data.error = old.data.error;
    }
    const opType = familyOf(rec) === "CHOP" ? "chop" : familyOf(rec) === "POP" ? "pop" : familyOf(rec) === "MAT" ? "mat" : familyOf(rec) === "COMP" ? "comp" : "top";
    return { ...base, type: opType, data };
  }
  if (rec.kind === "audio" || rec.kind === "webcam") return { ...base, data: { kind: rec.kind, family: "TOP", label: rec.label, bypass: rec.bypass ?? false } };
  if (rec.kind !== "shader") return { ...base, data: { kind: "out", family: "TOP", label: rec.label, bypass: rec.bypass ?? false } };

  const draft = codeMap.get(id)?.toString() ?? "";
  const was = old?.data.kind === "shader" ? old.data : null;
  const parsed = was && was.draft === draft ? null : parseShader(draft);
  const schema = parsed ? mergeParams(was?.params ?? [], parsed.params) : (was?.params ?? []);
  const params = schema.map((param) => decodeShaderParam(param, paramsMap.get(`${id}/${param.name}`)));
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
    bypass: rec.bypass ?? was?.bypass ?? false,
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
  const kept: Edge[] = [];
  const taken = new Set<string>();
  const drop: string[] = [];
  const entries = [...edgesMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [id, rec] of entries) {
    const source = byId.get(rec.source);
    const target = byId.get(rec.target);
    const slot = `${rec.target}:${rec.targetHandle}`;
    const bad =
      !source ||
      !target ||
      source.data.family !== target.data.family ||
      !nodeOutlet(source.data) ||
      !keepsWire(target.data, rec.targetHandle) ||
      taken.has(slot) ||
      reaches(rec.target, rec.source, kept);
    if (bad) {
      drop.push(id);
      continue;
    }
    taken.add(slot);
    kept.push({
      id,
      source: rec.source,
      target: rec.target,
      sourceHandle: "out",
      targetHandle: rec.targetHandle,
      style: wireStyle(source.data.family),
    });
  }
  if (drop.length) doc.transact(() => drop.forEach((id) => edgesMap.delete(id)), QUIET);
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
  if (a.data.kind !== b.data.kind || a.data.label !== b.data.label || a.data.bypass !== b.data.bypass) return false;
  if (a.data.kind === "op" && b.data.kind === "op") {
    if (a.data.type !== b.data.type || a.data.family !== b.data.family || a.data.pars.length !== b.data.pars.length) return false;
    const theirs = b.data.pars;
    return a.data.pars.every((par, index) => samePar(par, theirs[index]));
  }
  if (a.data.kind !== "shader" || b.data.kind !== "shader") return true;
  if (a.data.draft !== b.data.draft || a.data.committed !== b.data.committed) return false;
  const theirs = b.data.params;
  if (a.data.params.length !== theirs.length) return false;
  return a.data.params.every((param, i) => {
    const other = theirs[i];
    return other !== undefined && param.name === other.name && sameValue(encodeShaderParam(param), encodeShaderParam(other));
  });
}

function samePar(a: Par | undefined, b: Par | undefined): boolean {
  if (!a || !b || a.kind !== b.kind || a.name !== b.name) return false;
  if (a.kind === "number" && b.kind === "number") return a.mode === b.mode && a.value === b.value && a.expr === b.expr;
  if (a.kind === "menu" && b.kind === "menu") return a.value === b.value;
  if (a.kind === "text" && b.kind === "text") return a.value === b.value;
  return false;
}

function sameValue(a: ParamValue | undefined, b: ParamValue): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (typeof a === "number" || typeof b === "number") return a === b;
  if (!a) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------- awareness

interface PeerState {
  user?: Peer;
  // Not `cursor`: y-codemirror owns that field for the text caret ({ anchor, head }).
  pointer?: Cursor | null;
  editing?: string | null;
  agent?: boolean;
}

let peerKey = "";

function readPeers(awareness: Awareness): void {
  const peers: Peer[] = [];
  const cursors: Cursor[] = [];
  awareness.getStates().forEach((raw, clientId) => {
    if (clientId === awareness.clientID) return;
    const state = raw as PeerState;
    if (!state.user) return;
    peers.push({ ...state.user, editing: state.editing ?? null, agent: state.agent === true });
    if (state.pointer) cursors.push(state.pointer);
  });
  engine.setRoomCursors(cursors);
  // Cursors move at pointer rate; only re-render React when membership or focus changes.
  const key = peers.map((peer) => `${peer.id}:${peer.editing ?? ""}:${peer.agent ? 1 : 0}`).join("|");
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
    awareness.setLocalStateField("pointer", cursorPending);
    cursorPending = null;
  });
}

export function setEditing(id: string | null): void {
  getAwareness()?.setLocalStateField("editing", id);
}

export function setAgent(active: boolean): void {
  getAwareness()?.setLocalStateField("agent", active);
}
