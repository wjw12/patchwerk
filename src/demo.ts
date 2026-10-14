import type { Edge } from "@xyflow/react";
import { buildGraph, type GraphFile } from "./graph-file";
import cloud from "../tests/graphs/cloud.json";
import type { PNode } from "./store";

export function demoGraph(): { nodes: PNode[]; edges: Edge[] } {
  const built = buildGraph(cloud as GraphFile);
  return { nodes: built.nodes, edges: built.edges };
}
