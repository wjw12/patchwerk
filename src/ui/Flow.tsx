import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import { isValidConnection, useGraph } from "../store";
import { TopNode } from "./TopNode";

const nodeTypes = { top: TopNode };

export function Flow() {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const onNodesChange = useGraph((state) => state.onNodesChange);
  const onEdgesChange = useGraph((state) => state.onEdgesChange);
  const onConnect = useGraph((state) => state.onConnect);
  const setEditorOpen = useGraph((state) => state.setEditorOpen);

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
        onNodeDoubleClick={() => setEditorOpen(true)}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ style: { stroke: "#8d7cff", strokeWidth: 1.8 } }}
        connectionLineStyle={{ stroke: "#8d7cff", strokeWidth: 1.8 }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#242838" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={() => "#2a2460"} maskColor="rgba(0,0,0,0.55)" />
      </ReactFlow>
    </div>
  );
}
