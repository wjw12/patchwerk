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
import { TEMPLATE } from "./engine/sources";
import { parseShader, type ShaderParam } from "./engine/wrap";
import { readSession } from "./session";

export type Family = "TOP" | "CHOP";

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
  params: ShaderParam[];
}

export interface AudioData {
  [key: string]: unknown;
  kind: "audio";
  family: Family;
  label: string;
}

export interface OutData {
  [key: string]: unknown;
  kind: "out";
  family: Family;
  label: string;
}

export type NodeData = ShaderData | AudioData | OutData;
export type PNode = Node<NodeData, "top">;

const KEY = "patchwerk.graph.v2";
const WIRE = "#8d7cff";

export interface GraphState {
  nodes: PNode[];
  edges: Edge[];
  editorOpen: boolean;
  mic: "off" | "live" | "denied";
  gpuError: string | null;
  onNodesChange: (changes: NodeChange<PNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: OnConnect;
  updateDraft: (id: string, draft: string) => void;
  setParam: (id: string, name: string, value: number | [number, number, number]) => void;
  applyCompile: (id: string, patch: { status: "live" | "error"; error: string | null; committed?: string }) => void;
  setEditorOpen: (open: boolean) => void;
  setMic: (mic: GraphState["mic"]) => void;
  setGpuError: (message: string | null) => void;
  addShader: () => void;
  save: () => void;
  load: () => boolean;
  reset: () => void;
  replace: (nodes: PNode[], edges: Edge[]) => void;
}

function channelsOf(node: PNode): number[] {
  if (node.data.kind === "out") return [0];
  if (node.data.kind === "shader") return node.data.channels;
  return [];
}

export function isValidConnection(connection: Edge | Connection): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;
  if (connection.sourceHandle && connection.sourceHandle !== "out") return false;
  const { nodes, edges } = useGraph.getState();
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) return false;
  if (source.data.family !== target.data.family) return false;
  const handle = connection.targetHandle ?? "";
  const channel = Number(handle.replace("ch", ""));
  if (!handle.startsWith("ch") || !channelsOf(target).includes(channel)) return false;
  const occupied = edges.some(
    (edge) => edge.target === connection.target && edge.targetHandle === handle && edge.source !== connection.source,
  );
  if (occupied) return false;
  return !reaches(connection.target, connection.source, edges);
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
    if (param.kind === "float" && old.kind === "float") return { ...param, value: old.value };
    if (param.kind === "color" && old.kind === "color") return { ...param, value: old.value };
    return param;
  });
}

function readSaved(): { nodes: PNode[]; edges: Edge[] } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { nodes?: PNode[]; edges?: Edge[] };
    if (!Array.isArray(data.nodes) || data.nodes.length === 0 || !Array.isArray(data.edges)) return null;
    return { nodes: data.nodes, edges: data.edges };
  } catch {
    return null;
  }
}

function initialGraph(): { nodes: PNode[]; edges: Edge[] } {
  const session = readSession();
  if (session.fixed) return session.graph ? { nodes: [], edges: [] } : demoGraph();
  return readSaved() ?? demoGraph();
}

const initial = initialGraph();

export const useGraph = create<GraphState>((set, get) => ({
  nodes: initial.nodes,
  edges: initial.edges,
  editorOpen: true,
  mic: "off",
  gpuError: null,
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) => {
    if (!isValidConnection(connection)) return;
    set({
      edges: addEdge({ ...connection, style: { stroke: WIRE, strokeWidth: 1.8 } }, get().edges),
    });
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
      const open = new Set(parsed.channels.map((channel) => `ch${channel}`));
      const edges = state.edges.filter((edge) => edge.target !== id || (edge.targetHandle != null && open.has(edge.targetHandle)));
      return { nodes, edges };
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
            params: node.data.params.map((param) => {
              if (param.name !== name) return param;
              if (param.kind === "float" && typeof value === "number") return { ...param, value };
              if (param.kind === "color" && Array.isArray(value)) return { ...param, value };
              return param;
            }),
          },
        };
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
  setMic: (mic) => set({ mic }),
  setGpuError: (message) => set({ gpuError: message }),
  addShader: () => {
    const parsed = parseShader(TEMPLATE);
    const id = `s${crypto.randomUUID().slice(0, 6)}`;
    const node: PNode = {
      id,
      type: "top",
      position: { x: 120 + Math.random() * 180, y: 80 + Math.random() * 140 },
      selected: true,
      data: {
        kind: "shader",
        family: "TOP",
        label: id,
        draft: TEMPLATE,
        committed: null,
        status: "idle",
        error: null,
        channels: parsed.channels,
        feedback: parsed.feedback,
        params: parsed.params,
      },
    };
    set((state) => ({
      editorOpen: true,
      nodes: [...state.nodes.map((item) => ({ ...item, selected: false })), node],
    }));
  },
  save: () => {
    const { nodes, edges } = get();
    localStorage.setItem(KEY, JSON.stringify({ nodes, edges }));
  },
  load: () => {
    const saved = readSaved();
    if (!saved) return false;
    set(saved);
    return true;
  },
  reset: () => {
    localStorage.removeItem(KEY);
    set(demoGraph());
  },
  replace: (nodes, edges) => set({ nodes, edges }),
}));
