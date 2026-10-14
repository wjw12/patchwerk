import { useLayoutEffect, useRef, useState } from "react";
import { useAssistant, type Entry, type ToolEntry } from "../ai/client";
import type { ToolName } from "../ai/protocol";
import { readSession } from "../session";
import { useSync } from "../sync";

const OPEN_KEY = "patchwerk.assistant.open";
const READS = new Set<ToolName>(["get_graph", "read_shader", "view"]);
const GLYPH: Record<ToolName, string> = {
  get_graph: "≡",
  read_shader: "≡",
  view: "◉",
  write_shader: "✎",
  set_param: "✎",
  edit_node: "✎",
  add_node: "+",
  connect: "+",
  disconnect: "−",
};

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    return;
  }
}

export function Assistant() {
  const [open, setOpen] = useState(readOpen);
  const [draft, setDraft] = useState("");
  const status = useAssistant((state) => state.status);
  const error = useAssistant((state) => state.error);

  const toggle = () => {
    writeOpen(!open);
    setOpen(!open);
  };

  if (!open) {
    return (
      <aside className="assistant is-shut">
        <button type="button" className="assistant-strip" title={error ?? "open the assistant"} onClick={toggle}>
          <b>›</b>
          <span>assistant</span>
          {status !== "idle" && <i className={`assistant-dot is-${status}`} />}
        </button>
      </aside>
    );
  }
  return (
    <aside className="assistant">
      <Panel draft={draft} setDraft={setDraft} onCollapse={toggle} />
    </aside>
  );
}

function Panel({ draft, setDraft, onCollapse }: { draft: string; setDraft: (text: string) => void; onCollapse: () => void }) {
  const status = useAssistant((state) => state.status);
  const transcript = useAssistant((state) => state.transcript);
  const cost = useAssistant((state) => state.cost);
  const model = useAssistant((state) => state.model);
  const synced = useSync((state) => state.synced);
  const [fixed] = useState(() => readSession().fixed);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const busy = status === "connecting" || status === "running";
  const reason = fixed ? "off in a fixed ?graph= session" : synced ? null : "waiting for the room to sync";

  useLayoutEffect(() => {
    const box = log.current;
    if (box && stick.current) box.scrollTop = box.scrollHeight;
  }, [transcript, busy]);

  const submit = () => {
    if (reason || busy || !draft.trim()) return;
    stick.current = true;
    void useAssistant.getState().send(draft);
    setDraft("");
  };

  return (
    <>
      <header>
        <b>assistant</b>
        {model && (
          <span className="assistant-model" title={model}>
            {model}
          </span>
        )}
        <span className="assistant-actions">
          {cost > 0 && <em title="spent by the assistant from this tab">${cost.toFixed(2)}</em>}
          {busy ? (
            <button type="button" className="assistant-stop" onClick={() => useAssistant.getState().stop()}>
              stop
            </button>
          ) : (
            transcript.length > 0 && (
              <button type="button" title="forget this conversation and start a new one" onClick={() => useAssistant.getState().clear()}>
                clear
              </button>
            )
          )}
          <button type="button" className="assistant-fold" title="collapse the assistant" onClick={onCollapse}>
            ‹
          </button>
        </span>
      </header>
      <div
        className="assistant-log"
        ref={log}
        onScroll={() => {
          const box = log.current;
          if (box) stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 32;
        }}
      >
        {transcript.length === 0 && (
          <p className="empty">Ask for a change. Claude reads this room's graph, looks at frames, and edits parameters, shaders and wires; everyone here sees the edits.</p>
        )}
        {transcript.map((entry, index) => (
          <Item key={index} entry={entry} />
        ))}
        {busy && <p className="say-working">{status === "connecting" ? "connecting…" : "working…"}</p>}
      </div>
      <form
        className="assistant-input"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          rows={3}
          disabled={reason !== null}
          placeholder="what should change? e.g. make it more blue"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />
        <div>
          <small>{reason ?? (busy ? "stop interrupts the turn" : "Enter sends, Shift+Enter for a new line")}</small>
          <button type="submit" disabled={reason !== null || busy || !draft.trim()}>
            send
          </button>
        </div>
      </form>
    </>
  );
}

function Item({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "user":
      return <p className="say-user">{entry.text}</p>;
    case "text":
      return <p className="say-text">{entry.text}</p>;
    case "tool":
      return <Tool entry={entry} />;
    case "done":
      return (
        <p className={`say-done${entry.isError ? " is-error" : ""}`}>
          {entry.isError ? entry.message || "stopped" : `done · ${entry.turns} ${entry.turns === 1 ? "turn" : "turns"} · $${entry.cost.toFixed(2)}`}
        </p>
      );
    case "error":
      return <p className="say-error">{entry.message}</p>;
  }
}

function Tool({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen(!open);
  const args = formatArgs(entry.input);
  return (
    <div className={`say-tool${entry.pending ? " is-pending" : ""}${entry.isError ? " is-error" : ""}${open ? " is-open" : ""}`}>
      <button type="button" onClick={toggle}>
        <i>{GLYPH[entry.name]}</i>
        <b>{entry.name}</b>
        <span>{summary(entry)}</span>
      </button>
      {entry.images.length > 0 && (
        <div className="say-images">
          {entry.images.map((data, index) => (
            <img key={index} src={`data:image/png;base64,${data}`} alt={`${entry.name} frame ${index + 1}`} onClick={toggle} />
          ))}
        </div>
      )}
      {open && (
        <>
          {args && <pre className="say-args">{args}</pre>}
          <pre>{entry.pending ? "running…" : entry.result || "(no text)"}</pre>
        </>
      )}
    </div>
  );
}

function brief(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([key]) => key !== "code")
    .map(([, value]) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(" ");
}

function summary(entry: ToolEntry): string {
  if (entry.pending || READS.has(entry.name)) return brief(entry.input);
  const lines = entry.result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (entry.isError) return lines[0] ?? "failed";
  const deltas = lines.filter((line) => /^([~+!-] |error — )/.test(line));
  if (deltas.length === 1) return deltas[0]?.replace(/^[~+!-] /, "") ?? "";
  if (deltas.length > 1) return deltas.join("  ");
  const first = lines[0];
  return first ? `${brief(entry.input)} → ${first}` : brief(entry.input);
}

function formatArgs(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([key, value]) => {
      if (typeof value !== "string") return `${key}: ${JSON.stringify(value)}`;
      return value.includes("\n") ? `${key}:\n${value}` : `${key}: ${value}`;
    })
    .join("\n");
}
