import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAudioFile, playFile } from "../audio";
import { CHROME } from "../family";
import { inletCount } from "../ops/catalog";
import { isValidConnection, nodeOutlet, useGraph, type Placing, type PNode } from "../store";
import { beginGesture, breakUndo, endGesture, redo, undo } from "../sync";
import { importFile, isGraphFile } from "./graph-io";
import { OpNode } from "./OpNode";
import { Palette } from "./Palette";

const nodeTypes = { top: OpNode, chop: OpNode, pop: OpNode, mat: OpNode, comp: OpNode };
// The bottom keeps clear of the minimap so a fitted graph's last node isn't under it.
const FIT_PADDING = { top: "28px", left: "56px", right: "28px", bottom: "120px" } as const;
/** Where a held op hangs from the cursor: by its header, a little in from the left. */
const GRAB = { x: 24, y: 12 };

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
  const placing = useGraph((state) => state.placing);
  const cancelPlacing = useGraph((state) => state.cancelPlacing);
  const addOp = useGraph((state) => state.addOp);
  const reconnect = useGraph((state) => state.reconnect);
  const box = useRef<HTMLDivElement>(null);
  // Last pointer position, and whether it was over the network: Tab opens the palette there.
  const cursor = useRef({ x: 0, y: 0, inside: false });
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  // True while a wire end is being dragged by its reconnect anchor.
  const reconnecting = useRef(false);
  // The wire already in an inlet a drag started from: dropped on nothing, it comes out (TD's pull-off).
  const lifted = useRef<string | null>(null);
  const [wire, setWire] = useState(CHROME.TOP.wire);
  const [dropping, setDropping] = useState(false);
  const fit = useGraph((state) => state.fit);
  const flow = useReactFlow();
  const swallowClick = useRef(false);
  // A right-button press that cancelled a held op; its contextmenu must not open the browser's.
  const cancelledMenu = useRef(false);

  // On mount and for a whole new graph (import, example, reset, joining a room): fit it once
  // React Flow has measured it. The fitView prop ignores px paddings on its first fit.
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => void flow.fitView({ padding: FIT_PADDING, duration: 250 }));
    });
    return () => cancelAnimationFrame(frame);
  }, [fit, flow]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = isTyping(event.target);
      if ((event.key === "Tab" || event.key === "`") && !typing) {
        event.preventDefault();
        const at = cursor.current.inside ? cursor.current : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        openPalette(at.x, at.y, { family: selectedFamily() });
      }
      if (event.key === "Escape") {
        closePalette();
        cancelPlacing();
      }
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
    const onMove = (event: PointerEvent) => {
      const inside = !!box.current?.contains(event.target as Node | null);
      cursor.current = { x: event.clientX, y: event.clientY, inside };
      if (useGraph.getState().placing) setGhost({ x: event.clientX, y: event.clientY });
    };
    // A click anywhere but the network drops a held op.
    const onDown = (event: PointerEvent) => {
      if (useGraph.getState().placing && !box.current?.contains(event.target as Node | null)) cancelPlacing();
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onDown, true);
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
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [openPalette, closePalette, cancelPlacing]);

  useEffect(() => {
    if (!placing) setGhost(null);
  }, [placing]);

  /** A wire dropped on empty network opens the palette there, pre-wired to the end it came from. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState): void => {
      const pulled = lifted.current;
      lifted.current = null;
      // A reconnect drag ends here too; onReconnectEnd decides what happens to that wire.
      if (reconnecting.current) return;
      const point = droppedOnPane(event, state);
      if (!point || !state.fromNode || !state.fromHandle) return;
      if (pulled) {
        onEdgesChange([{ type: "remove", id: pulled }]);
        return;
      }
      const from = state.fromNode.id;
      const family = (state.fromNode.data as PNode["data"]).family;
      if (state.fromHandle.type === "source") openPalette(point.clientX, point.clientY, { here: true, family, after: from });
      else openPalette(point.clientX, point.clientY, { here: true, family, after: null, into: { target: from, handle: state.fromHandle.id ?? "" } });
    },
    [onEdgesChange, openPalette],
  );

  const onReconnectStart = useCallback(() => {
    reconnecting.current = true;
  }, []);
  const onReconnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, edge: Edge, _type: unknown, state: FinalConnectionState) => {
      reconnecting.current = false;
      // Dropped on nothing, the wire comes out. Dropped on an inlet that refuses it, it stays.
      if (droppedOnPane(event, state)) onEdgesChange([{ type: "remove", id: edge.id }]);
    },
    [onEdgesChange],
  );

  const held = placing ? (ghost ?? { x: placing.x, y: placing.y }) : null;
  const from = placing ? heldFrom(placing) : undefined;

  return (
    <div
      ref={box}
      className={`flow${dropping ? " is-dropping" : ""}${placing ? " is-placing" : ""}`}
      onPointerDownCapture={(event) => {
        const held = useGraph.getState().placing;
        if (!held) return;
        // Zooming or panning from the corner widgets keeps holding the op.
        swallowClick.current = false;
        if ((event.target as Element).closest(".react-flow__controls, .react-flow__minimap")) return;
        // The click that puts a held op down is not also a pan, a selection box or a node drag.
        event.preventDefault();
        event.stopPropagation();
        if (event.button !== 0) {
          cancelledMenu.current = event.button === 2;
          cancelPlacing();
          return;
        }
        addOp(held.family, held.type, {
          position: flow.screenToFlowPosition({ x: event.clientX - GRAB.x, y: event.clientY - GRAB.y }),
          // Unwired unless shift-clicked: then after the one selected node, if it can feed the op.
          after: held.after !== undefined ? held.after : event.shiftKey ? undefined : null,
          into: held.into,
        });
        swallowClick.current = true;
      }}
      onClickCapture={(event) => {
        // The pane would deselect the op that click just put down.
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        if (!useGraph.getState().placing && !cancelledMenu.current) return;
        cancelledMenu.current = false;
        event.preventDefault();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        setDropping(false);
        const file = event.dataTransfer.files[0];
        if (!file) return;
        event.preventDefault();
        if (isGraphFile(file)) void importFile(file);
        else if (isAudioFile(file)) void playFile(file);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        isValidConnection={replacing}
        onConnectEnd={onConnectEnd}
        edgesReconnectable
        connectionRadius={28}
        onReconnectStart={onReconnectStart}
        onReconnect={reconnect}
        onReconnectEnd={onReconnectEnd}
        onEdgeDoubleClick={(event, edge) => {
          const source = useGraph.getState().nodes.find((node) => node.id === edge.source);
          openPalette(event.clientX, event.clientY, {
            here: true,
            family: source?.data.family,
            after: edge.source,
            into: { target: edge.target, handle: edge.targetHandle ?? "" },
          });
        }}
        onNodeDoubleClick={(_, node) => {
          const data = node.data as PNode["data"];
          if (data.kind === "shader") setEditorOpen(true);
        }}
        onPaneClick={(event) => {
          if (event.detail === 2) openPalette(event.clientX, event.clientY, { family: selectedFamily() });
        }}
        onConnectStart={(_, params: { nodeId?: string | null; handleId?: string | null; handleType?: string | null }) => {
          const { nodes: all, edges: wires } = useGraph.getState();
          const node = all.find((item) => item.id === params.nodeId);
          if (node) setWire(CHROME[node.data.family].wire);
          lifted.current =
            params.handleType === "target"
              ? (wires.find((edge) => edge.target === params.nodeId && edge.targetHandle === params.handleId)?.id ?? null)
              : null;
        }}
        zoomOnDoubleClick={false}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ style: { stroke: CHROME.TOP.wire, strokeWidth: 1.8 } }}
        connectionLineStyle={{ stroke: wire, strokeWidth: 1.8 }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#242838" />
        <Controls showInteractive={false} fitViewOptions={{ padding: FIT_PADDING, duration: 250 }} />
        <MiniMap
          pannable
          zoomable
          style={{ width: 132, height: 84 }}
          nodeColor={(node) => CHROME[(node.data as PNode["data"]).family]?.header ?? "#2a2460"}
          maskColor="rgba(0,0,0,0.55)"
        />
      </ReactFlow>
      <Palette />
      {placing && held && (
        <div className="held" style={{ left: held.x - GRAB.x, top: held.y - GRAB.y }}>
          <header style={{ background: CHROME[placing.family].header }}>
            <b>{placing.type}</b>
            <span>{placing.family}</span>
          </header>
          <p>
            click to place{placing.after ? (from ? ` · wired from ${from}` : "") : from ? ` · shift-click: wire from ${from}` : ""}
            <br />
            esc or right-click cancels
          </p>
        </div>
      )}
    </div>
  );
}

/** The label a held op can be wired from: the node it was opened from, else the one selected node, if it can feed it. */
function heldFrom(placing: Placing): string | undefined {
  if (placing.after === null) return undefined;
  const { nodes } = useGraph.getState();
  const picked = nodes.filter((node) => node.selected);
  const source = placing.after ? nodes.find((node) => node.id === placing.after) : picked.length === 1 ? picked[0] : undefined;
  if (!source || source.data.family !== placing.family || !nodeOutlet(source.data)) return undefined;
  if (!hasFirstInlet(placing.family, placing.type)) return undefined;
  return source.data.label;
}

/** The palette opens on the family of the one selected node, as TD's OP Create dialog does. */
function selectedFamily(): PNode["data"]["family"] | undefined {
  const picked = useGraph.getState().nodes.filter((node) => node.selected);
  return picked.length === 1 ? picked[0]?.data.family : undefined;
}

function replacing(connection: Connection | Edge): boolean {
  return isValidConnection(connection, true);
}

/** Where a wire was let go, if that was empty network. A touch ends on the element it began on, so ask the point. */
function droppedOnPane(event: MouseEvent | TouchEvent, state: FinalConnectionState): { clientX: number; clientY: number } | null {
  if (state.isValid || state.toNode) return null;
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  if (!point) return null;
  const under = document.elementFromPoint(point.clientX, point.clientY);
  return under?.classList.contains("react-flow__pane") ? point : null;
}

/** Whether a new op of this type has an inlet to wire into. A new shader TOP's template reads no channel. */
function hasFirstInlet(family: PNode["data"]["family"], type: string): boolean {
  if (type === "out") return true;
  if (type === "shader" || type === "audio") return false;
  return inletCount(family, type) > 0;
}

// A focused slider, color well or checkbox has no text undo, so Ctrl+Z there still undoes the graph.
const TEXT_INPUTS = new Set(["text", "number", "search", "email", "url", "password", "tel"]);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return TEXT_INPUTS.has(target.type);
  return target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

export type { Connection, Edge };

