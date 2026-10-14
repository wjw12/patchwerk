import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, type Connection, type Edge } from "@xyflow/react";
import { useEffect, useState } from "react";
import { CHROME } from "../family";
import { isValidConnection, useGraph, type PNode } from "../store";
import { beginGesture, breakUndo, endGesture, redo, undo } from "../sync";
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
      const typing = isTyping(event.target);
      if ((event.key === "Tab" || event.key === "`") && !typing) {
        event.preventDefault();
        openPalette(window.innerWidth / 2, window.innerHeight / 2);
      }
      if (event.key === "Escape") closePalette();
      // Text fields and CodeMirror keep their own Ctrl+Z.
      if (typing) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      // A key that edits the graph (Delete) is its own undo step, apart from a drag just before it.
      breakUndo();
    };
    const onFocus = (event: FocusEvent) => {
      if (isTyping(event.target)) breakUndo();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", beginGesture, true);
    window.addEventListener("pointerup", endGesture, true);
    window.addEventListener("pointercancel", endGesture, true);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", beginGesture, true);
      window.removeEventListener("pointerup", endGesture, true);
      window.removeEventListener("pointercancel", endGesture, true);
      window.removeEventListener("focusin", onFocus);
    };
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
        zoomOnDoubleClick={false}
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

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

export type { Connection, Edge };
