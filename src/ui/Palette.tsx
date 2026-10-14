import { useReactFlow } from "@xyflow/react";
import { type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FAMILIES, type Family } from "../family";
import { paletteEntries } from "../ops/catalog";
import { useGraph } from "../store";

export function Palette() {
  const palette = useGraph((state) => state.palette);
  const closePalette = useGraph((state) => state.closePalette);
  const addOp = useGraph((state) => state.addOp);
  const flow = useReactFlow();
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<Family | "all">("all");
  const box = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Dragging moves the panel only. New ops still land where it was opened.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  // Focus in the same task that opened the palette, so a key typed right after Tab or a
  // double-click lands in the filter instead of being dropped.
  useLayoutEffect(() => {
    if (!palette) return;
    setQuery("");
    setFamily("all");
    setOffset({ x: 0, y: 0 });
    box.current?.focus();
  }, [palette]);

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return paletteEntries().filter((entry) => {
      if (family !== "all" && entry.family !== family) return false;
      return needle === "" || entry.type.includes(needle);
    });
  }, [query, family]);

  if (!palette) return null;

  function place(type: string, opFamily: Family): void {
    if (!palette) return;
    addOp(opFamily, type, { position: flow.screenToFlowPosition({ x: palette.x, y: palette.y }) });
  }

  function move(event: PointerEvent): void {
    if (!drag || !palette || !panel.current) return;
    // Keep the bar on screen so the panel can always be grabbed back.
    const width = panel.current.offsetWidth;
    const x = Math.min(Math.max(event.clientX - drag.x, 40 - width), window.innerWidth - 40);
    const y = Math.min(Math.max(event.clientY - drag.y, 0), window.innerHeight - 24);
    setOffset({ x: x - palette.x, y: y - palette.y });
  }

  return (
    <div
      ref={panel}
      className="palette"
      style={{ left: palette.x + offset.x, top: palette.y + offset.y }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div
        className={`palette-bar${drag ? " is-dragging" : ""}`}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ x: event.clientX - palette.x - offset.x, y: event.clientY - palette.y - offset.y });
        }}
        onPointerMove={move}
        onPointerUp={() => {
          setDrag(null);
          box.current?.focus();
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <span>add op</span>
        <button type="button" title="close (Esc)" onClick={closePalette}>
          ×
        </button>
      </div>
      <input
        ref={box}
        value={query}
        placeholder="filter ops"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") closePalette();
          if (event.key === "Enter" && entries[0]) place(entries[0].type, entries[0].family);
        }}
      />
      <div className="palette-filters">
        <button type="button" className={family === "all" ? "is-on" : ""} onClick={() => setFamily("all")}>
          all
        </button>
        {FAMILIES.map((item) => (
          <button key={item} type="button" className={family === item ? "is-on" : ""} onClick={() => setFamily(item)}>
            {item.toLowerCase()}
          </button>
        ))}
      </div>
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.family}:${entry.type}`}>
            <button type="button" onClick={() => place(entry.type, entry.family)}>
              <i className={`fam-${entry.family}`} />
              {entry.type}
              <em>{entry.family}</em>
            </button>
          </li>
        ))}
        {entries.length === 0 && <li className="empty">no matching op</li>}
      </ul>
    </div>
  );
}
