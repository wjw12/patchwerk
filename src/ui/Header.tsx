import { useEffect, useRef, useState } from "react";
import { engine } from "../engine/engine";
import { roomUrl } from "../room";
import { useGraph } from "../store";
import { useSync } from "../sync";
import { Playbar } from "./Playbar";

export function Header() {
  const gpuError = useGraph((state) => state.gpuError);
  const openPalette = useGraph((state) => state.openPalette);
  const save = useGraph((state) => state.save);
  const load = useGraph((state) => state.load);
  const reset = useGraph((state) => state.reset);
  const room = useSync((state) => state.room);
  const status = useSync((state) => state.status);
  const peers = useSync((state) => state.peers);
  const [copied, setCopied] = useState(false);
  const hud = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = hud.current;
    if (!node) return;
    if (gpuError) node.textContent = gpuError;
    else if (!node.textContent) node.textContent = "booting";
  }, [gpuError]);

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
        <button
          type="button"
          onClick={() => {
            save();
          }}
        >
          save
        </button>
        <button
          type="button"
          onClick={() => {
            if (load()) engine.invalidate();
          }}
        >
          load
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            engine.invalidate();
          }}
        >
          reset
        </button>
      </div>
    </header>
  );
}
