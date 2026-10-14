import type { Edge } from "@xyflow/react";
import { rfType, wireStyle, type Family } from "./family";
import { parseShader, patchShaderParam, type ShaderParam } from "./engine/wrap";
import { applyParOverrides, createOpData, migrateLegacyRenders, type ParOverride } from "./ops/catalog";
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
  params?: Record<string, number | string | number[] | { mode?: "constant" | "expression"; value?: number; expr?: string }>;
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
  const saved = new Map(file.nodes.map((node) => [node.id, node]));
  migrateLegacyRenders(nodes, (id, name) => {
    const value = saved.get(id)?.pars?.[name];
    return typeof value === "string" ? value : null;
  });
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
    const data: AudioData = { kind: "audio", family: "TOP", label: node.label ?? node.id, bypass: node.bypass ?? false };
    return { id: node.id, type: "top", position, selected, data };
  }
  if (node.kind === "out") {
    const data: OutData = { kind: "out", family: "TOP", label: node.label ?? node.id, bypass: node.bypass ?? false };
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

/**
 * The graph as a file `buildGraph` reads back. A shader whose draft is one of src/ops is
 * written by name like tests/graphs; any other draft goes inline as `source`. Op
 * parameters are written only where they differ from the operator's defaults.
 */
export function toGraphFile(nodes: PNode[], edges: Edge[]): GraphFile {
  const out = nodes.find((node) => node.data.kind === "out") ?? nodes.at(-1);
  return {
    viewer: out?.id,
    nodes: nodes.map((node): GraphNode => {
      const { data } = node;
      const base = {
        id: node.id,
        kind: data.kind,
        label: data.label,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        ...(data.bypass ? { bypass: true } : {}),
      };
      if (data.kind === "op") {
        const defaults = createOpData(data.family, data.type, data.label).pars;
        const pars: Record<string, ParOverride> = {};
        for (const par of data.pars) {
          const was = defaults.find((item) => item.name === par.name);
          if (par.kind === "number") {
            const same = was?.kind === "number" && was.mode === par.mode && was.value === par.value && was.expr === par.expr;
            if (same) continue;
            pars[par.name] = par.mode === "expression" ? { mode: "expression", expr: par.expr, value: par.value } : par.value;
          } else if (was?.value !== par.value) {
            pars[par.name] = par.value;
          }
        }
        return { ...base, family: data.family, type: data.type, ...(Object.keys(pars).length ? { pars } : {}) };
      }
      if (data.kind !== "shader") return base;
      const named = Object.entries(shaders).find(([, source]) => source === data.draft)?.[0];
      const params: NonNullable<GraphNode["params"]> = {};
      for (const param of data.params) {
        if (param.kind === "color") params[param.name] = [...param.value];
        else if (param.kind === "menu") params[param.name] = param.value;
        else if (param.mode === "expression") params[param.name] = { mode: "expression", expr: param.expr ?? "", value: param.value };
        else params[param.name] = param.value;
      }
      return {
        ...base,
        ...(named ? { shader: named.slice(named.lastIndexOf("/") + 1) } : { source: data.draft }),
        ...(data.params.length ? { params } : {}),
      };
    }),
    edges: edges.map((edge) => ({ source: edge.source, target: edge.target, targetHandle: edge.targetHandle ?? "ch0" })),
  };
}

const examples = import.meta.glob("../tests/graphs/*.json", { import: "default" }) as Record<string, () => Promise<GraphFile>>;
/** Test fixtures that only make sense to the visual test. */
const FIXTURES = new Set(["feedback-precision", "template"]);

/** The graphs in tests/graphs, by name, bundled with the app. */
export const EXAMPLES: { name: string; load: () => Promise<GraphFile> }[] = Object.entries(examples)
  .map(([path, load]) => ({ name: path.slice(path.lastIndexOf("/") + 1, -".json".length), load }))
  .filter((example) => !FIXTURES.has(example.name))
  .sort((a, b) => a.name.localeCompare(b.name));

/** A room with nothing but the final picture. */
export const BLANK: GraphFile = { viewer: "out", nodes: [{ id: "out", kind: "out", label: "out", x: 480, y: 200 }], edges: [] };

/** What a new room can start from: `blank`, `demo` (the cloud example), or any example by name. */
export async function templateFile(name: string): Promise<GraphFile | null> {
  if (name === "blank") return BLANK;
  const hit = EXAMPLES.find((example) => example.name === (name === "demo" ? "cloud" : name));
  return hit ? hit.load() : null;
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
    if (param.kind === "float" && (typeof next === "number" || (typeof next === "object" && !Array.isArray(next)))) {
      return patchShaderParam(param, next);
    }
    if (param.kind === "color" && typeof next === "string") return { ...param, value: hexRgb(next) };
    if (param.kind === "menu" && typeof next === "string") return patchShaderParam(param, { menu: next });
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
