import type { Edge } from "@xyflow/react";
import { parseShader, type ShaderParam } from "./engine/wrap";
import type { PNode, ShaderData } from "./store";

const shaders = import.meta.glob("./ops/*.glsl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const wire = "#8d7cff";

interface GraphNode {
  id: string;
  kind: "shader" | "audio" | "out";
  label?: string;
  shader?: string;
  source?: string;
  x?: number;
  y?: number;
  params?: Record<string, number | string | number[]>;
}

export interface GraphFile {
  viewer?: string;
  nodes: GraphNode[];
  edges: { source: string; target: string; targetHandle?: string }[];
}

export function buildGraph(file: GraphFile): { nodes: PNode[]; edges: Edge[]; viewer: string } {
  if (!Array.isArray(file.nodes) || file.nodes.length === 0) throw new Error("graph has no nodes");
  const viewer = file.viewer ?? "out";
  const nodes = file.nodes.map((node) => toNode(node, node.id === viewer));
  if (!nodes.some((node) => node.id === viewer)) throw new Error(`graph viewer "${viewer}" is not a node`);
  const edges = (file.edges ?? []).map((edge) => {
    const handle = edge.targetHandle ?? "ch0";
    return {
      id: `${edge.source}-${edge.target}-${handle}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: "out",
      targetHandle: handle,
      style: { stroke: wire, strokeWidth: 1.8 },
    };
  });
  return { nodes, edges, viewer };
}

function toNode(node: GraphNode, selected: boolean): PNode {
  const position = { x: node.x ?? 0, y: node.y ?? 0 };
  if (node.kind === "audio") {
    return { id: node.id, type: "top", position, selected, data: { kind: "audio", family: "TOP", label: node.label ?? node.id } };
  }
  if (node.kind === "out") {
    return { id: node.id, type: "top", position, selected, data: { kind: "out", family: "TOP", label: node.label ?? node.id } };
  }
  if (node.kind !== "shader") throw new Error(`unknown node kind on ${node.id}`);
  const source = node.source ?? lookupShader(node.shader ?? "");
  const parsed = parseShader(source);
  const data: ShaderData = {
    kind: "shader",
    family: "TOP",
    label: node.label ?? node.id,
    draft: source,
    committed: null,
    status: "idle",
    error: null,
    channels: parsed.channels,
    feedback: parsed.feedback,
    params: applyOverrides(parsed.params, node.params),
  };
  return { id: node.id, type: "top", position, selected, data };
}

function lookupShader(name: string): string {
  if (!name) throw new Error("shader node is missing shader or source");
  const hit = Object.entries(shaders).find(([path]) => path.endsWith(`/${name}`));
  if (!hit) throw new Error(`shader ${name} is not in src/ops`);
  return hit[1];
}

function applyOverrides(params: ShaderParam[], overrides: GraphNode["params"]): ShaderParam[] {
  if (!overrides) return params;
  return params.map((param) => {
    const next = overrides[param.name];
    if (next == null) return param;
    if (param.kind === "float" && typeof next === "number") return { ...param, value: next };
    if (param.kind === "color" && typeof next === "string") return { ...param, value: hexRgb(next) };
    if (param.kind === "color" && Array.isArray(next) && next.length === 3) {
      return { ...param, value: [Number(next[0]), Number(next[1]), Number(next[2])] };
    }
    return param;
  });
}

function hexRgb(hex: string): [number, number, number] {
  const body = hex.replace("#", "");
  return [parseInt(body.slice(0, 2), 16) / 255, parseInt(body.slice(2, 4), 16) / 255, parseInt(body.slice(4, 6), 16) / 255];
}
