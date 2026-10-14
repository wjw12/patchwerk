import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, type Connection, type Edge } from "@xyflow/react";
import { useEffect, useState } from "react";
import { CHROME } from "../family";
import { isValidConnection, useGraph, type PNode } from "../store";
import { OpNode } from "./OpNode";
import { Palette } from "./Palette";

const nodeTypes = { top: OpNode, chop: OpNode, pop: OpNode, mat: OpNode, comp: OpNode };

export function Flow() {
  return (
    <ReactFlowProvider>
      <Stage />
    </ReactFlowProvider>
  );
}

function Stage() {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const onNodesChange = useGraph((state) => state.onNodesChange);
  const onEdgesChange = useGraph((state) => state.onEdgesChange);
  const onConnect = useGraph((state) => state.onConnect);
  const setEditorOpen = useGraph((state) => state.setEditorOpen);
  const openPalette = useGraph((state) => state.openPalette);
  const closePalette = useGraph((state) => state.closePalette);
  const [wire, setWire] = useState(CHROME.TOP.wire);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "Tab" || event.key === "`") && !typing) {
        event.preventDefault();
        openPalette(window.innerWidth / 2, window.innerHeight / 2);
      }
      if (event.key === "Escape") closePalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, closePalette]);

  return (
    <div className="flow">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        isValidConnection={isValidConnection}
        onNodeDoubleClick={(_, node) => {
          const data = node.data as PNode["data"];
          if (data.kind === "shader") setEditorOpen(true);
        }}
        onPaneClick={(event) => {
          if (event.detail === 2) openPalette(event.clientX, event.clientY);
        }}
        onConnectStart={(_, params: { nodeId?: string | null }) => {
          const node = useGraph.getState().nodes.find((item) => item.id === params.nodeId);
          if (node) setWire(CHROME[node.data.family].wire);
        }}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ style: { stroke: CHROME.TOP.wire, strokeWidth: 1.8 } }}
        connectionLineStyle={{ stroke: wire, strokeWidth: 1.8 }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#242838" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => CHROME[(node.data as PNode["data"]).family]?.header ?? "#2a2460"}
          maskColor="rgba(0,0,0,0.55)"
        />
      </ReactFlow>
      <Palette />
    </div>
  );
}

export type { Connection, Edge };
