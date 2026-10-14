import { useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
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

  useEffect(() => {
    if (!palette) return;
    setQuery("");
    setFamily("all");
    const id = window.setTimeout(() => box.current?.focus(), 0);
    return () => window.clearTimeout(id);
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
    addOp(opFamily, type, flow.screenToFlowPosition({ x: palette.x, y: palette.y }));
  }

  return (
    <div className="palette" style={{ left: palette.x, top: palette.y }} onKeyDown={(event) => event.stopPropagation()}>
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
