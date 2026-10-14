import { useEffect, useRef, useState } from "react";
import { demoGraph } from "../demo";
import { EXAMPLES } from "../graph-file";
import { roomUrl } from "../room";
import { clearSaved, savedGraph, useGraph } from "../store";
import { redo, undo, useHistory, useSync } from "../sync";
import { exportGraph, importFile, loadGraph, loadGraphFile } from "./graph-io";
import { Playbar } from "./Playbar";

export function Header() {
  const gpuError = useGraph((state) => state.gpuError);
  const openPalette = useGraph((state) => state.openPalette);
  const save = useGraph((state) => state.save);
  const room = useSync((state) => state.room);
  const status = useSync((state) => state.status);
  const peers = useSync((state) => state.peers);
  const canUndo = useHistory((state) => state.canUndo);
  const canRedo = useHistory((state) => state.canRedo);
  const [copied, setCopied] = useState(false);
  const hud = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const node = hud.current;
    if (!node) return;
    if (gpuError) node.textContent = gpuError;
    else if (!node.textContent) node.textContent = "booting";
  }, [gpuError]);

  // The graph menu closes on any click outside it.
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

  return (
    <header className="topbar">
      <strong>patchwerk</strong>
      <Playbar />
      <span id="hud" ref={hud} />
      {room && (
        <div className={`room is-${status}`}>
          <i />
          <button
            type="button"
            title="copy the room link"
            onClick={() => {
              void navigator.clipboard.writeText(roomUrl(room)).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? "copied" : room}
          </button>
          {peers.map((peer) => (
            <span key={peer.id} className="peer" style={{ background: peer.color }} title={peer.editing ? `editing ${peer.editing}` : undefined}>
              {peer.name}
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
        <details className="menu graph-menu" ref={menu}>
          <summary>graph</summary>
          <div className="menu-body">
            <button
              type="button"
              onClick={() => {
                shut();
                picker.current?.click();
              }}
            >
              import…
            </button>
            <button
              type="button"
              onClick={() => {
                shut();
                exportGraph();
              }}
            >
              export
            </button>
            <hr />
            <em>examples</em>
            {EXAMPLES.map((example) => (
              <button
                key={example.name}
                type="button"
                data-example={example.name}
                onClick={() => {
                  shut();
                  void example.load().then((file) => loadGraphFile(file, `the ${example.name} example`));
                }}
              >
                {example.name}
              </button>
            ))}
            <hr />
            <button
              type="button"
              title="keep the graph in this browser"
              onClick={() => {
                shut();
                save();
              }}
            >
              save in browser
            </button>
            <button
              type="button"
              onClick={() => {
                shut();
                const saved = savedGraph();
                if (saved) loadGraph(saved, "the graph saved in this browser");
                else window.alert("Nothing is saved in this browser yet.");
              }}
            >
              load from browser
            </button>
            <button
              type="button"
              onClick={() => {
                shut();
                if (loadGraph(demoGraph(), "the demo graph")) clearSaved();
              }}
            >
              reset to demo
            </button>
          </div>
        </details>
        <input
          ref={picker}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
    </header>
  );
}
