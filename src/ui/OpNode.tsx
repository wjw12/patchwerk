import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { engine } from "../engine/engine";
import { CHROME } from "../family";
import { keepsWire, nodeInlets, nodeOutlet, useGraph, type PNode } from "../store";

export function OpNode({ id, data, selected }: NodeProps<PNode>) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rename = useGraph((state) => state.rename);
  const setBypass = useGraph((state) => state.setBypass);
  const setEditorOpen = useGraph((state) => state.setEditorOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const renameTimer = useRef(0);
  const showCanvas = data.family === "TOP" || data.family === "CHOP" || data.family === "POP";

  useEffect(() => {
    setDraft(data.label);
  }, [data.label]);

  useEffect(() => () => window.clearTimeout(renameTimer.current), []);

  useEffect(() => {
    if (!showCanvas) return;
    const canvas = ref.current;
    if (!canvas) return;
    engine.setPreview(id, canvas);
    return () => engine.setPreview(id, null);
  }, [id, showCanvas]);

  const tone = CHROME[data.family];
  const read = nodeInlets(data);
  // A shader's inlets follow its draft; a wire into a channel the draft no longer reads stays, dimmed.
  const wired = useGraph((state) => state.edges.filter((edge) => edge.target === id).map((edge) => edge.targetHandle ?? "").join(" "));
  const extra = data.kind === "shader" ? wired.split(" ").filter((handle) => keepsWire(data, handle) && !read.includes(handle)) : [];
  const inlets = [...read, ...extra].sort();
  const updateInternals = useUpdateNodeInternals();
  const inletKey = inlets.join(" ");
  useEffect(() => updateInternals(id), [id, inletKey, updateInternals]);
  const outlet = nodeOutlet(data);
  const error = useSettledError((data.kind === "shader" || data.kind === "op") && data.status === "error" ? (data.error ?? "") : null);
  const bad = error !== null;
  const live = data.kind !== "shader" && data.kind !== "op" ? true : data.status === "live";
  const typeName = data.kind === "op" ? data.type : data.kind;

  return (
    <div
      className={`op-node${selected ? " is-selected" : ""}${bad ? " is-error" : ""}${data.bypass ? " is-bypass" : ""}${showCanvas ? "" : " is-bare"}`}
      onDoubleClick={() => {
        window.clearTimeout(renameTimer.current);
        if (data.kind === "shader") setEditorOpen(true);
      }}
    >
      <header style={{ background: tone.header }}>
        {editing ? (
          <input
            className="rename"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              rename(id, draft);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              if (event.key === "Escape") {
                setDraft(data.label);
                setEditing(false);
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <b
            onClick={(event) => {
              if (!selected) return;
              event.stopPropagation();
              window.clearTimeout(renameTimer.current);
              renameTimer.current = window.setTimeout(() => setEditing(true), 220);
            }}
            onDoubleClick={() => window.clearTimeout(renameTimer.current)}
          >
            {data.label}
          </b>
        )}
        <span>{typeName}</span>
        {data.family === "CHOP" && (
          <em
            className="chop-drag nodrag nopan"
            draggable
            title="drag onto a parameter"
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-patchwerk-chop", data.label);
              event.dataTransfer.setData("text/plain", data.label);
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            ƒ
          </em>
        )}
        <button
          type="button"
          className={data.bypass ? "is-on" : ""}
          title="bypass"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setBypass(id, !data.bypass);
          }}
        >
          b
        </button>
        <i className={live && !bad ? "ok" : bad ? "bad" : "idle"} />
      </header>
      {showCanvas && <canvas ref={ref} width={160} height={90} />}
      {inlets.map((inlet, index) => (
        <Handle
          key={inlet}
          type="target"
          id={inlet}
          className={extra.includes(inlet) ? "is-unused" : undefined}
          title={extra.includes(inlet) ? `the draft does not read iChannel${inlet.slice(2)}` : undefined}
          position={Position.Left}
          style={{ top: (showCanvas ? 58 : 28) + index * 16, background: tone.wire }}
        />
      ))}
      {inlets.map((inlet, index) => (
        <em
          key={inlet}
          className={`port-label${extra.includes(inlet) ? " is-unused" : ""}`}
          style={{ top: (showCanvas ? 50 : 20) + index * 16, color: tone.wire }}
        >
          {inlet.replace("ch", "").replace("in", "")}
        </em>
      ))}
      {outlet && <Handle type="source" id="out" position={Position.Right} style={{ background: tone.wire }} />}
      {error && <p>{error.split("\n")[0]}</p>}
    </div>
  );
}

/** An error shows once it has held for a moment, so typing an expression or shader doesn't flash red. It clears at once. */
function useSettledError(error: string | null, wait = 400): string | null {
  const [shown, setShown] = useState(error);
  useEffect(() => {
    if (error === null) {
      setShown(null);
      return;
    }
    const timer = window.setTimeout(() => setShown(error), wait);
    return () => window.clearTimeout(timer);
  }, [error, wait]);
  return shown;
}
