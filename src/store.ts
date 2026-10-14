import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react";
import { create } from "zustand";
import { demoGraph } from "./demo";
import { rfType, wireStyle, type Family } from "./family";
import { TEMPLATE } from "./engine/sources";
import { parseShader, patchShaderParam, type ShaderParam, type ShaderParamPatch } from "./engine/wrap";
import {
  applyParOverrides,
  createOpData,
  hasOutlet,
  inletHandles,
  namesLabel,
  renamedValue,
  type InletSource,
  type OpData,
  type Par,
  type ParMode,
  type ParOverride,
} from "./ops/catalog";
import { readSession } from "./session";

export type { Family, OpData, Par, ParMode };

export interface ShaderData {
  [key: string]: unknown;
  kind: "shader";
  family: Family;
  label: string;
  draft: string;
  committed: string | null;
  status: "idle" | "live" | "error";
  error: string | null;
  channels: number[];
  feedback: boolean;
  bypass: boolean;
  params: ShaderParam[];
}

export interface AudioData {
  [key: string]: unknown;
  kind: "audio";
  family: Family;
  label: string;
  bypass: boolean;
}

export interface WebcamData {
  [key: string]: unknown;
  kind: "webcam";
  family: Family;
  label: string;
  bypass: boolean;
}

export interface OutData {
  [key: string]: unknown;
  kind: "out";
  family: Family;
  label: string;
  bypass: boolean;
}

export type NodeData = ShaderData | AudioData | WebcamData | OutData | OpData;
export type RfKind = "top" | "chop" | "pop" | "mat" | "comp";

export interface AddOpOptions {
  position?: { x: number; y: number };
  /** Wire this node's outlet into the new op's first inlet. Unset: the one selected node; null: no wire. */
  after?: string | null;
  /** Feed this inlet from the new op, replacing whatever fed it: insert into a wire, or grow a chain backwards. */
  into?: Inlet;
  label?: string;
  select?: boolean;
}

export interface Inlet {
  target: string;
  handle: string;
}

/** Where a new op from the palette goes and what it wires to, fixed when the palette opens. */
export interface AddIntent {
  after?: string | null;
  into?: Inlet;
  /** Opened from a dropped wire or a wire: the op lands where the palette opened instead of following the cursor. */
  here?: boolean;
  family?: Family;
}

export interface Placing extends AddIntent {
  family: Family;
  type: string;
  x: number;
  y: number;
}
export type PNode = Node<NodeData, RfKind>;

export interface GraphState {
  nodes: PNode[];
  edges: Edge[];
  editorOpen: boolean;
  playing: boolean;
  palette: ({ x: number; y: number } & AddIntent) | null;
  /** An op picked from the palette, following the cursor until a click puts it down. */
  placing: Placing | null;
  gpuError: string | null;
  onNodesChange: (changes: NodeChange<PNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: OnConnect;
  /** A wire end dragged to another inlet or outlet. Refused: the old wire stays. */
  reconnect: (old: Edge, connection: Connection) => void;
  updateDraft: (id: string, draft: string) => void;
  setParam: (id: string, name: string, value: ShaderParamPatch) => void;
  setOpPar: (id: string, name: string, patch: ParOverride & { text?: string; menu?: string }) => void;
  setBypass: (id: string, bypass: boolean) => void;
  rename: (id: string, label: string) => void;
  setCookStatus: (id: string, status: "live" | "error", error: string | null) => void;
  applyCompile: (id: string, patch: { status: "live" | "error"; error: string | null; committed?: string }) => void;
  setEditorOpen: (open: boolean) => void;
  setPlaying: (playing: boolean) => void;
  openPalette: (x: number, y: number, intent?: AddIntent) => void;
  closePalette: () => void;
  startPlacing: (placing: Placing) => void;
  cancelPlacing: () => void;
  setGpuError: (message: string | null) => void;
  addOp: (family: Family, type: string, options?: AddOpOptions) => string;
  replace: (nodes: PNode[], edges: Edge[]) => void;
  /** Bumped when a whole graph was loaded; the network fits its view to it. */
  fit: number;
  requestFit: () => void;
}

export function nodeInlets(data: NodeData): string[] {
  return inletHandles(inletSource(data));
}

export function nodeOutlet(data: NodeData): boolean {
  return hasOutlet(inletSource(data));
}

function inletSource(data: NodeData): InletSource {
  return {
    kind: data.kind,
    family: data.family,
    type: data.kind === "op" ? data.type : undefined,
    channels: data.kind === "shader" ? data.channels : undefined,
  };
}

/**
 * Whether an existing wire into this handle stays. A shader's inlets follow its draft, which is
 * half-typed text, so every iChannel slot keeps its wire; the node only dims an unread one.
 */
export function keepsWire(data: NodeData, handle: string): boolean {
  if (data.kind === "shader") return /^ch[0-3]$/.test(handle);
  return nodeInlets(data).includes(handle);
}

/** `replace`: an inlet that already has a wire takes the new one instead (the network does this; the assistant must disconnect first). */
export function isValidConnection(connection: Edge | Connection, replace = false): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;
  if (connection.sourceHandle && connection.sourceHandle !== "out") return false;
  const { nodes, edges } = useGraph.getState();
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) return false;
  if (source.data.family !== target.data.family) return false;
  if (!nodeOutlet(source.data)) return false;
  const handle = connection.targetHandle ?? "";
  if (!nodeInlets(target.data).includes(handle)) return false;
  const occupied = edges.some(
    (edge) => edge.target === connection.target && edge.targetHandle === handle && edge.source !== connection.source,
  );
  if (occupied && !replace) return false;
  // A wire being replaced cannot be what closes the loop.
  const rest = replace ? edges.filter((edge) => !(edge.target === connection.target && edge.targetHandle === handle)) : edges;
  return !reaches(connection.target, connection.source, rest);
}

function reaches(from: string, to: string, edges: Edge[]): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    if (id === to) return true;
    seen.add(id);
    for (const edge of edges) {
      if (edge.source === id) stack.push(edge.target);
    }
  }
  return false;
}

export function mergeParams(prev: ShaderParam[], next: ShaderParam[]): ShaderParam[] {
  return next.map((param) => {
    const old = prev.find((item) => item.name === param.name && item.kind === param.kind);
    if (!old) return param;
    if (param.kind === "float" && old.kind === "float") return { ...param, value: old.value, mode: old.mode, expr: old.expr };
    if (param.kind === "color" && old.kind === "color") return { ...param, value: old.value };
    if (param.kind === "menu" && old.kind === "menu") return { ...param, value: old.value };
    return param;
  });
}

function initialGraph(): { nodes: PNode[]; edges: Edge[] } {
  const session = readSession();
  if (session.fixed) return session.graph ? { nodes: [], edges: [] } : demoGraph();
  // A room shows the demo until its own graph (or the template it starts from) arrives.
  return demoGraph();
}

const initial = initialGraph();

export const useGraph = create<GraphState>((set, get) => ({
  nodes: initial.nodes,
  edges: initial.edges,
  editorOpen: false,
  playing: true,
  palette: null,
  placing: null,
  gpuError: null,
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) => {
    if (!isValidConnection(connection, true)) return;
    const source = get().nodes.find((node) => node.id === connection.source);
    const style = wireStyle(source?.data.family ?? "TOP");
    // One wire per inlet: a new one replaces the old.
    const kept = get().edges.filter((edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle));
    set({ edges: addEdge({ ...connection, style }, kept) });
  },
  reconnect: (old, connection) => {
    // React Flow checked the drop already; one set, so peers never cook a frame without either wire.
    const source = get().nodes.find((node) => node.id === connection.source);
    const kept = get().edges.filter(
      (edge) => edge.id !== old.id && !(edge.target === connection.target && edge.targetHandle === connection.targetHandle),
    );
    set({ edges: addEdge({ ...connection, style: wireStyle(source?.data.family ?? "TOP") }, kept) });
  },
  updateDraft: (id, draft) => {
    const parsed = parseShader(draft);
    set((state) => {
      const nodes = state.nodes.map((node) => {
        if (node.id !== id || node.data.kind !== "shader") return node;
        const data: ShaderData = {
          ...node.data,
          draft,
          channels: parsed.channels,
          feedback: parsed.feedback,
          params: mergeParams(node.data.params, parsed.params),
        };
        return { ...node, data };
      });
      // Wires stay: a draft is half-typed text and the last good program may still read the channel.
      return { nodes };
    });
  },
  setParam: (id, name, value) =>
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== id || node.data.kind !== "shader") return node;
        return {
          ...node,
          data: {
            ...node.data,
            params: node.data.params.map((param) => (param.name === name ? patchShaderParam(param, value) : param)),
          },
        };
      }),
    })),
  setOpPar: (id, name, patch) =>
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== id || node.data.kind !== "op") return node;
        return {
          ...node,
          data: {
            ...node.data,
            pars: node.data.pars.map((par) => applyOne(par, name, patch)),
          },
        };
      }),
    })),
  setBypass: (id, bypass) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === id ? { ...node, data: { ...node.data, bypass } } : node)),
    })),
  rename: (id, label) => {
    const want = label.trim();
    if (!want) return;
    set((state) => {
      const old = state.nodes.find((node) => node.id === id)?.data.label;
      if (old == null) return {};
      const next = uniqueLabel(want, state.nodes, id);
      if (next === old) return {};
      return {
        nodes: state.nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, label: next } } : followRename(node, old, next),
        ),
      };
    });
  },
  setCookStatus: (id, status, error) =>
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== id || node.data.kind !== "op") return node;
        if (node.data.status === status && node.data.error === error) return node;
        return { ...node, data: { ...node.data, status, error } };
      }),
    })),
  applyCompile: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== id || node.data.kind !== "shader") return node;
        return {
          ...node,
          data: {
            ...node.data,
            status: patch.status,
            error: patch.error,
            committed: patch.committed ?? node.data.committed,
          },
        };
      }),
    })),
  setEditorOpen: (open) => set({ editorOpen: open }),
  setPlaying: (playing) => set({ playing }),
  openPalette: (x, y, intent = {}) => set({ palette: { x, y, ...intent }, placing: null }),
  closePalette: () => set({ palette: null }),
  startPlacing: (placing) => set({ palette: null, placing }),
  cancelPlacing: () => set({ placing: null }),
  setGpuError: (message) => set({ gpuError: message }),
  addOp: (family, type, options = {}) => {
    const select = options.select ?? true;
    const id = `${type.slice(0, 4)}${crypto.randomUUID().slice(0, 4)}`;
    const { nodes, edges } = get();
    const picked = nodes.filter((item) => item.selected);
    const after =
      options.after === null
        ? undefined
        : options.after
          ? nodes.find((item) => item.id === options.after)
          : select && picked.length === 1
            ? picked[0]
            : undefined;
    const at = options.position ?? placeNear(after, nodes);
    const node = makeNode(id, uniqueLabel(options.label ?? `${type}1`, nodes), family, type, at, select);
    if (node.data.kind === "op") node.data = { ...node.data, pars: guessRefs(node.data.pars, nodes, edges, after) };
    const inlet = nodeInlets(node.data)[0];
    const wire = after && inlet && after.data.family === family && nodeOutlet(after.data);
    const into = options.into && nodes.find((item) => item.id === options.into?.target);
    const feeds = into && options.into && into.data.family === family && nodeOutlet(node.data) && keepsWire(into.data, options.into.handle);
    set((state) => {
      let next = wire
        ? addEdge({ source: after.id, sourceHandle: "out", target: id, targetHandle: inlet, style: wireStyle(family) }, state.edges)
        : state.edges;
      if (feeds && options.into) {
        const { target, handle } = options.into;
        next = next.filter((edge) => !(edge.target === target && edge.targetHandle === handle));
        next = addEdge({ source: id, sourceHandle: "out", target, targetHandle: handle, style: wireStyle(family) }, next);
      }
      return {
        palette: null,
        placing: null,
        editorOpen: select && type === "shader" ? true : state.editorOpen,
        nodes: select ? [...state.nodes.map((item) => ({ ...item, selected: false })), node] : [...state.nodes, node],
        edges: next,
      };
    });
    return id;
  },
  replace: (nodes, edges) => set({ nodes, edges }),
  fit: 0,
  requestFit: () => set((state) => ({ fit: state.fit + 1 })),
}));

function applyOne(par: Par, name: string, patch: ParOverride & { text?: string; menu?: string }): Par {
  if (par.name !== name) return par;
  if (par.kind === "menu") {
    const value = typeof patch === "string" ? patch : patch.menu;
    if (value && par.options.includes(value)) return { ...par, value };
    return par;
  }
  if (par.kind === "text") {
    const value = typeof patch === "string" ? patch : patch.text;
    if (typeof value === "string") return { ...par, value };
    return par;
  }
  if (typeof patch === "number") return { ...par, mode: "constant", value: patch };
  if (typeof patch === "string") return par;
  const next = { ...par };
  if (patch.mode) next.mode = patch.mode;
  if (typeof patch.value === "number" && Number.isFinite(patch.value)) next.value = patch.value;
  if (typeof patch.expr === "string") next.expr = patch.expr;
  return next;
}

/**
 * Fills a new op's empty op-name fields (geo's pop/mat/cam, render's geo): the selected op if it
 * fits, else the only candidate, else the one that ends a chain, else the newest.
 */
function guessRefs(pars: Par[], nodes: PNode[], edges: Edge[], selected: PNode | undefined): Par[] {
  return pars.map((par) => {
    if (par.kind !== "text" || !par.ref || par.value) return par;
    const want = par.ref;
    const fits = (node: PNode) =>
      node.data.family === want.family && (!want.type || (node.data.kind === "op" && node.data.type === want.type));
    const candidates = nodes.filter(fits);
    const ends = candidates.filter((node) => !edges.some((edge) => edge.source === node.id));
    const pick =
      (selected && fits(selected) ? selected : undefined) ??
      (candidates.length === 1 ? candidates[0] : undefined) ??
      (ends.length === 1 ? ends[0] : undefined) ??
      candidates.at(-1);
    return pick ? { ...par, value: pick.data.label } : par;
  });
}

/** Labels are how op('name') and geo/render find a node, so no two nodes share one: noise1, noise2. */
export function uniqueLabel(want: string, nodes: PNode[], self?: string): string {
  const taken = new Set(nodes.filter((node) => node.id !== self).map((node) => node.data.label));
  if (!taken.has(want)) return want;
  const base = want.replace(/\d+$/, "");
  for (let n = 1; ; n++) {
    if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }
}

/** Points op('old') expressions and op-name parameters at the new label. Unchanged nodes keep identity. */
function followRename(node: PNode, old: string, next: string): PNode {
  const call = new RegExp(`op\\(\\s*(['"])${old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1\\s*\\)`, "g");
  if (node.data.kind === "shader") {
    let moved = false;
    const params = node.data.params.map((param): ShaderParam => {
      if (param.kind !== "float" || !param.expr) return param;
      const expr = param.expr.replace(call, (_match, quote: string) => `op(${quote}${next}${quote})`);
      if (expr === param.expr) return param;
      moved = true;
      return { ...param, expr };
    });
    return moved ? { ...node, data: { ...node.data, params } } : node;
  }
  if (node.data.kind !== "op") return node;
  let changed = false;
  const pars = node.data.pars.map((par): Par => {
    if (par.kind === "number" && par.expr) {
      const expr = par.expr.replace(call, (_match, quote: string) => `op(${quote}${next}${quote})`);
      if (expr === par.expr) return par;
      changed = true;
      return { ...par, expr };
    }
    if (par.kind === "text" && namesLabel(par, old)) {
      changed = true;
      return { ...par, value: renamedValue(par, old, next) };
    }
    return par;
  });
  return changed ? { ...node, data: { ...node.data, pars } } : node;
}

function placeNear(after: PNode | undefined, nodes: PNode[]): { x: number; y: number } {
  if (after) return clearOf({ x: after.position.x + 220, y: after.position.y }, nodes);
  if (nodes.length === 0) return { x: 120, y: 80 };
  return { x: 120, y: Math.max(...nodes.map((node) => node.position.y)) + 160 };
}

function clearOf(at: { x: number; y: number }, nodes: PNode[]): { x: number; y: number } {
  let y = at.y;
  while (nodes.some((node) => Math.abs(node.position.x - at.x) < 200 && Math.abs(node.position.y - y) < 140)) y += 160;
  return { x: at.x, y };
}

function makeNode(id: string, label: string, family: Family, type: string, position: { x: number; y: number }, selected: boolean): PNode {
  if (type === "shader" && family === "TOP") {
    const parsed = parseShader(TEMPLATE);
    const data: ShaderData = {
      kind: "shader",
      family: "TOP",
      label,
      draft: TEMPLATE,
      committed: null,
      status: "idle",
      error: null,
      channels: parsed.channels,
      feedback: parsed.feedback,
      bypass: false,
      params: parsed.params,
    };
    return { id, type: "top", position, selected, data };
  }
  if (type === "audio" && family === "TOP") {
    return { id, type: "top", position, selected, data: { kind: "audio", family: "TOP", label, bypass: false } };
  }
  if (type === "webcam" && family === "TOP") {
    return { id, type: "top", position, selected, data: { kind: "webcam", family: "TOP", label, bypass: false } };
  }
  if (type === "out" && family === "TOP") {
    return { id, type: "top", position, selected, data: { kind: "out", family: "TOP", label, bypass: false } };
  }
  const data = createOpData(family, type, label);
  return { id, type: rfType(family), position, selected, data };
}

export function patchPars(pars: Par[], overrides: Record<string, ParOverride> | undefined): Par[] {
  return applyParOverrides(pars, overrides);
}
