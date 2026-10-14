import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { shader } from "@codemirror/legacy-modes/mode/clike";
import { StreamLanguage } from "@codemirror/language";
import { linter, forceLinting, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { errorMarks } from "../engine/wrap";
import { useGraph } from "../store";
import { getAwareness, getCode, setEditing, useSync } from "../sync";

const glsl = StreamLanguage.define(shader);

export function Editor({ height, onResize }: { height: number; onResize: (height: number) => void }) {
  const open = useGraph((state) => state.editorOpen);
  const setOpen = useGraph((state) => state.setEditorOpen);
  const node = useGraph((state) => state.nodes.find((item) => item.selected));
  const synced = useSync((state) => state.synced);
  const peers = useSync((state) => state.peers);
  const shader = node?.data.kind === "shader" ? node.data : null;
  const errorRef = useRef<string | null>(null);
  errorRef.current = shader?.error ?? null;
  const [view, setView] = useState<EditorView | null>(null);
  // The text lives in the room; until the first sync there is nothing to bind to.
  const text = node && shader && synced ? getCode(node.id) : null;
  const others = node ? peers.filter((peer) => peer.editing === node.id) : [];

  useEffect(() => {
    if (view) forceLinting(view);
  }, [shader?.error, view]);

  return (
    <section className={`drawer nokey${open ? "" : " is-shut"}`} style={{ height: open ? height : 36 }}>
      <div
        className="drawer-grip"
        onPointerDown={(event) => {
          if (!open) return;
          const startY = event.clientY;
          const startH = height;
          const move = (next: PointerEvent) => onResize(Math.min(window.innerHeight * 0.62, Math.max(140, startH + startY - next.clientY)));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <header>
        <button type="button" onClick={() => setOpen(!open)}>
          shader
        </button>
        <b>{node?.data.label ?? "none"}</b>
        {others.map((peer) => (
          <span key={peer.id} className="peer" style={{ background: peer.color }}>
            {peer.name}
          </span>
        ))}
        {shader?.status === "error" && shader.committed && <em>still running the last good shader</em>}
        {shader?.status === "live" && <em className="ok">compiled</em>}
        {shader?.status === "error" && !shader.committed && <em>not running</em>}
      </header>
      {open && shader && node && text && (
        <>
          {shader.error && <pre className="shader-error">{shader.error}</pre>}
          <CodeView key={node.id} id={node.id} text={text} errorRef={errorRef} onView={setView} />
        </>
      )}
      {open && shader && !text && <p className="empty">Connecting to the room…</p>}
      {open && !shader && <p className="empty">Double-click a shader node. Audio and out are built in.</p>}
    </section>
  );
}

function CodeView({
  id,
  text,
  errorRef,
  onView,
}: {
  id: string;
  text: Y.Text;
  errorRef: { current: string | null };
  onView: (view: EditorView | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = host.current;
    const awareness = getAwareness();
    if (!parent || !awareness) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap, indentWithTab]),
          glsl,
          oneDark,
          linter((view) => {
            const error = errorRef.current;
            if (!error) return [];
            return errorMarks(error, view.state.doc.lines).flatMap((mark): Diagnostic[] => {
              const lineNo = Math.min(Math.max(mark.line, 1), view.state.doc.lines);
              const line = view.state.doc.line(lineNo);
              return [{ from: line.from, to: line.to, severity: "error", message: mark.message }];
            });
          }),
          yCollab(text, awareness),
        ],
      }),
    });
    setEditing(id);
    onView(view);
    return () => {
      setEditing(null);
      onView(null);
      view.destroy();
    };
  }, [id, text, errorRef, onView]);

  return <div ref={host} className="code-host nokey" />;
}
