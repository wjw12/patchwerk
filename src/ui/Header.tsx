import { useEffect, useRef, useState } from "react";
import { toGraphFile } from "../graph-file";
import { handOff, newSlug, roomUrl } from "../room";
import { useGraph } from "../store";
import { dismissDiverged, redo, undo, useHistory, useSync, type Diverged } from "../sync";
import { exportGraph, importFile } from "./graph-io";
import { AudioInput } from "./AudioInput";
import { CameraInput } from "./CameraInput";
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
  const mode = useSync((state) => state.mode);
  const diverged = useSync((state) => state.diverged);
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

  const online = status === "connected";
  const state =
    online && synced ? "saved" : online ? "syncing" : mode === "local" ? "offline · local copy" : mode === "room" ? "offline · kept here" : status === "connecting" ? "connecting" : "offline";
  const why =
    online && synced
      ? "Saved on the server. Everyone with the link sees and edits this graph."
      : mode === "local"
        ? "The room server is unreachable and this browser has no copy of this room, so you are editing a local copy. When the server is back your copy goes into the room, or, if the room already has a graph, you can open your copy as a new room."
        : mode === "room" && !online
          ? "The room server is unreachable. Your edits are kept in this browser and sync when it is back."
          : "Connecting to the room server…";

  return (
    <header className="topbar">
      <strong>
        <a href="/" title="all rooms">
          patchwerk
        </a>
      </strong>
      <Playbar />
      <AudioInput />
      <CameraInput />
      <span id="hud" ref={hud} />
      {room && (
        <div className={`room is-${status}`}>
          <details className="menu room-menu" ref={menu}>
            <summary title={why}>
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
        <button type="button" className="add" title="add an op (Tab over the network, or double-click it)" onClick={() => openPalette(window.innerWidth / 2, 88)}>
          add <kbd>Tab</kbd>
        </button>
        <button type="button" className="undo" disabled={!canUndo} title="undo your last graph edit (Ctrl+Z)" onClick={undo}>
          ↶
        </button>
        <button type="button" className="redo" disabled={!canRedo} title="redo (Ctrl+Shift+Z)" onClick={redo}>
          ↷
        </button>
      </div>
      {picker && <TemplatePicker mode={picker} onClose={() => setPicker(null)} />}
      {diverged && <DivergedNotice diverged={diverged} />}
    </header>
  );
}

/** The server came back with its own graph after this tab edited a local copy of the room. */
function DivergedNotice({ diverged }: { diverged: Diverged }) {
  return (
    <div className="sync-notice" role="status">
      <span>The room server is back and this room already had a graph, so you are looking at it now. The edits you made offline were not merged.</span>
      <button
        type="button"
        onClick={() => {
          const room = newSlug();
          handOff(room, diverged.graph);
          window.open(`/r/${room}`, "_blank");
          dismissDiverged();
        }}
      >
        open my offline copy as a new room
      </button>
      <button type="button" onClick={dismissDiverged}>
        discard it
      </button>
    </div>
  );
}
