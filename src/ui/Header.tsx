import { useEffect, useRef, useState } from "react";
import { toGraphFile } from "../graph-file";
import { handOff, newSlug, roomUrl } from "../room";
import { useGraph } from "../store";
import { redo, undo, useHistory, useSync } from "../sync";
import { exportGraph, importFile } from "./graph-io";
import { AudioInput } from "./AudioInput";
import { Playbar } from "./Playbar";
import { FileButton, TemplatePicker } from "./Templates";

/** A copy of this room's graph in a fresh room of its own; this room is untouched. */
function duplicateRoom(): void {
  const { nodes, edges } = useGraph.getState();
  const room = newSlug();
  handOff(room, toGraphFile(nodes, edges));
  location.assign(`/r/${room}`);
}

export function Header() {
  const gpuError = useGraph((state) => state.gpuError);
  const openPalette = useGraph((state) => state.openPalette);
  const room = useSync((state) => state.room);
  const status = useSync((state) => state.status);
  const synced = useSync((state) => state.synced);
  const peers = useSync((state) => state.peers);
  const canUndo = useHistory((state) => state.canUndo);
  const canRedo = useHistory((state) => state.canRedo);
  const [copied, setCopied] = useState(false);
  const [picker, setPicker] = useState<"new" | "replace" | null>(null);
  const hud = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const node = hud.current;
    if (!node) return;
    if (gpuError) node.textContent = gpuError;
    else if (!node.textContent) node.textContent = "booting";
  }, [gpuError]);

  // The room menu closes on any click outside it.
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const box = menu.current;
      if (box?.open && !box.contains(event.target as Node)) box.open = false;
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  const shut = () => {
    if (menu.current) menu.current.open = false;
  };

  const state = status === "connected" && synced ? "saved" : status === "connected" ? "syncing" : status === "connecting" ? "connecting" : "offline";

  return (
    <header className="topbar">
      <strong>
        <a href="/" title="all rooms">
          patchwerk
        </a>
      </strong>
      <Playbar />
      <AudioInput />
      <span id="hud" ref={hud} />
      {room && (
        <div className={`room is-${status}`}>
          <details className="menu room-menu" ref={menu}>
            <summary title="Saved on the server. Everyone with the link sees and edits this graph.">
              <i />
              <b>{room}</b>
              <small>{state}</small>
            </summary>
            <div className="menu-body">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(roomUrl(room)).then(() => {
                    setCopied(true);
                    window.setTimeout(() => {
                      setCopied(false);
                      shut();
                    }, 900);
                  });
                }}
              >
                {copied ? "link copied" : "copy link"}
              </button>
              <hr />
              <button
                type="button"
                onClick={() => {
                  shut();
                  setPicker("new");
                }}
              >
                new room…
              </button>
              <button type="button" title="your own copy of this graph in a fresh room" onClick={duplicateRoom}>
                duplicate room
              </button>
              <button
                type="button"
                onClick={() => {
                  shut();
                  exportGraph();
                }}
              >
                export .json
              </button>
              <hr />
              <em>replace this room's graph</em>
              <button
                type="button"
                onClick={() => {
                  shut();
                  setPicker("replace");
                }}
              >
                with a template…
              </button>
              <FileButton
                label="with a file…"
                onFile={(file) => {
                  shut();
                  void importFile(file);
                }}
              />
              <hr />
              <a className="menu-link" href="/">
                all rooms
              </a>
            </div>
          </details>
          {peers.map((peer) => (
            <span key={peer.id} className="peer" style={{ background: peer.color }} title={peer.editing ? `editing ${peer.editing}` : undefined}>
              {peer.name}
              {peer.agent && (
                <span className="peer-agent" title="claude is working from this tab">
                  ✦
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="topbar-actions">
        <button type="button" onClick={() => openPalette(window.innerWidth / 2, 88)}>
          add
        </button>
        <button type="button" className="undo" disabled={!canUndo} title="undo your last graph edit (Ctrl+Z)" onClick={undo}>
          ↶
        </button>
        <button type="button" className="redo" disabled={!canRedo} title="redo (Ctrl+Shift+Z)" onClick={redo}>
          ↷
        </button>
      </div>
      {picker && <TemplatePicker mode={picker} onClose={() => setPicker(null)} />}
    </header>
  );
}
