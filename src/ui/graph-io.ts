// Moving whole graphs in and out of the room: export to a file, import a file, load an example.
import type { Edge } from "@xyflow/react";
import { engine } from "../engine/engine";
import { buildGraph, toGraphFile, type GraphFile } from "../graph-file";
import { useGraph, type PNode } from "../store";
import { replaceGraph, useSync } from "../sync";

/** Asks before a whole graph replaces the room's graph for everyone in it. */
export function loadGraph(graph: { nodes: PNode[]; edges: Edge[] }, what: string): boolean {
  const room = useSync.getState().room;
  if (room && !window.confirm(`Replace the graph in room "${room}" with ${what}? Everyone in the room sees the change. Ctrl+Z brings the old graph back.`)) {
    return false;
  }
  replaceGraph(graph.nodes, graph.edges);
  engine.invalidate();
  return true;
}

export function loadGraphFile(file: GraphFile, what: string): boolean {
  let built: ReturnType<typeof buildGraph>;
  try {
    built = buildGraph(file);
  } catch (error) {
    window.alert(`${what} is not a patchwerk graph: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  return loadGraph(built, what);
}

export async function importFile(file: File): Promise<boolean> {
  let parsed: GraphFile;
  try {
    parsed = JSON.parse(await file.text()) as GraphFile;
  } catch {
    window.alert(`${file.name} is not JSON.`);
    return false;
  }
  return loadGraphFile(parsed, file.name);
}

export function exportGraph(): void {
  const { nodes, edges } = useGraph.getState();
  const json = JSON.stringify(toGraphFile(nodes, edges), null, 2);
  const url = URL.createObjectURL(new Blob([`${json}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${useSync.getState().room || "patchwerk"}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isGraphFile(file: File): boolean {
  return file.type === "application/json" || file.name.toLowerCase().endsWith(".json");
}
