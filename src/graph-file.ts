import type { Edge } from "@xyflow/react";
import { rfType, wireStyle, type Family } from "./family";
import { parseShader, type ShaderParam } from "./engine/wrap";
import { applyParOverrides, createOpData, type ParOverride } from "./ops/catalog";
import type { AudioData, OutData, PNode, ShaderData } from "./store";

const shaders = import.meta.glob("./ops/*.glsl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FAMILIES = new Set<Family>(["POP", "CHOP", "TOP", "MAT", "COMP"]);

interface GraphNode {
  id: string;
  kind: string;
  family?: Family;
  type?: string;
  label?: string;
  shader?: string;
  source?: string;
  x?: number;
  y?: number;
  bypass?: boolean;
  params?: Record<string, number | string | number[]>;
  pars?: Record<string, ParOverride>;
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
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (file.edges ?? []).map((edge) => {
    const handle = edge.targetHandle ?? "ch0";
    const family = byId.get(edge.source)?.data.family ?? "TOP";
    return {
      id: `${edge.source}-${edge.target}-${handle}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: "out",
      targetHandle: handle,
      style: wireStyle(family),
    };
  });
  return { nodes, edges, viewer };
}

function toNode(node: GraphNode, selected: boolean): PNode {
  const position = { x: node.x ?? 0, y: node.y ?? 0 };
  if (node.kind === "audio") {
    const data: AudioData = { kind: "audio", family: "TOP", label: node.label ?? node.id, bypass: false };
    return { id: node.id, type: "top", position, selected, data };
  }
  if (node.kind === "out") {
    const data: OutData = { kind: "out", family: "TOP", label: node.label ?? node.id, bypass: false };
    return { id: node.id, type: "top", position, selected, data };
  }
  if (node.kind === "op") {
    if (!node.family || !FAMILIES.has(node.family) || !node.type) throw new Error(`operator ${node.id} needs a family and type`);
    const data = createOpData(node.family, node.type, node.label ?? node.id);
    data.bypass = node.bypass ?? false;
    data.pars = applyParOverrides(data.pars, node.pars);
    return { id: node.id, type: rfType(node.family), position, selected, data };
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
    bypass: node.bypass ?? false,
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
