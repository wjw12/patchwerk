import type { Edge } from "@xyflow/react";
import { MELT, WARP } from "./engine/sources";
import { parseShader } from "./engine/wrap";
import type { PNode, ShaderData } from "./store";

function shaderNode(id: string, label: string, source: string, position: { x: number; y: number }, selected = false): PNode {
  const parsed = parseShader(source);
  const data: ShaderData = {
    kind: "shader",
    family: "TOP",
    label,
    draft: source,
    committed: null,
    status: "idle",
    error: null,
    channels: parsed.channels,
    feedback: parsed.feedback,
    params: parsed.params,
  };
  return { id, type: "top", position, selected, data };
}

const wire = "#8d7cff";

export function demoGraph(): { nodes: PNode[]; edges: Edge[] } {
  const nodes: PNode[] = [
    {
      id: "audio",
      type: "top",
      position: { x: 24, y: 36 },
      data: { kind: "audio", family: "TOP", label: "audio" },
    },
    shaderNode("warp", "warp", WARP, { x: 24, y: 250 }),
    shaderNode("melt", "melt", MELT, { x: 320, y: 130 }, true),
    {
      id: "out",
      type: "top",
      position: { x: 640, y: 170 },
      data: { kind: "out", family: "TOP", label: "out" },
    },
  ];
  const edges: Edge[] = [
    { id: "warp-melt", source: "warp", target: "melt", sourceHandle: "out", targetHandle: "ch0", style: { stroke: wire, strokeWidth: 1.8 } },
    { id: "audio-melt", source: "audio", target: "melt", sourceHandle: "out", targetHandle: "ch1", style: { stroke: wire, strokeWidth: 1.8 } },
    { id: "melt-out", source: "melt", target: "out", sourceHandle: "out", targetHandle: "ch0", style: { stroke: wire, strokeWidth: 1.8 } },
  ];
  return { nodes, edges };
}
