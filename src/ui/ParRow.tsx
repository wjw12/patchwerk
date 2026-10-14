import { useEffect, useRef, useState } from "react";
import { useLive } from "../engine/live";
import type { ParOverride } from "../ops/catalog";
import { useGraph, type Par } from "../store";

type ParPatch = ParOverride & { text?: string; menu?: string };
/** Where a row writes. Ops default to setOpPar; a shader TOP passes its own setter. */
export type ParSetter = (name: string, patch: ParPatch) => void;

export function ParRow({ id, par, label, set }: { id: string; par: Par; label?: string; set?: ParSetter }) {
  const setOpPar = useGraph((state) => state.setOpPar);
  const write: ParSetter = set ?? ((name, patch) => setOpPar(id, name, patch));
  if (par.kind === "menu") {
    return (
      <label className="par-row">
        <span>{label ?? par.name}</span>
        <select value={par.value} onChange={(event) => write(par.name, { menu: event.target.value })}>
          {par.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (par.kind === "text") {
    return (
      <label className="par-row">
        <span>{label ?? par.name}</span>
        <input value={par.value} onChange={(event) => write(par.name, { text: event.target.value })} />
      </label>
    );
  }
  return <NumberRow id={id} par={par} label={label ?? par.name} write={write} />;
}

/** A vec3 @color uniform. */
export function ColorRow({ label, value, onChange }: { label: string; value: [number, number, number]; onChange: (rgb: [number, number, number]) => void }) {
  return (
    <label className="par-row">
      <span>{label}</span>
      <input type="color" className="par-color" value={rgbHex(value)} onChange={(event) => onChange(hexRgb(event.target.value))} />
    </label>
  );
}

function rgbHex([r, g, b]: [number, number, number]): string {
  const byte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function hexRgb(hex: string): [number, number, number] {
  const body = hex.replace("#", "");
  return [parseInt(body.slice(0, 2), 16) / 255, parseInt(body.slice(2, 4), 16) / 255, parseInt(body.slice(4, 6), 16) / 255];
}

function NumberRow({ id, par, label, write }: { id: string; par: Extract<Par, { kind: "number" }>; label: string; write: ParSetter }) {
  const live = useLive(id, par.name);
  const expressing = par.mode === "expression";
  const shown = expressing ? (live?.cooked ?? par.value) : par.value;
  // Half-typed expressions fail; hold the red state until typing pauses or the field is left.
  const [typing, setTyping] = useState(false);
  const pause = useRef(0);
  useEffect(() => () => window.clearTimeout(pause.current), []);
  const error = expressing && !typing ? (live?.error ?? null) : null;
  const step = par.step ?? Math.max((par.max - par.min) / 200, 0.001);
  // What the number box shows while it is being typed in; null shows the parameter.
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <label
      className={`par-row${error ? " is-error" : ""}`}
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes("application/x-patchwerk-chop")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const chop = event.dataTransfer.getData("application/x-patchwerk-chop");
        if (!chop) return;
        event.preventDefault();
        write(par.name, { mode: "expression", expr: `op('${chop}')['chan1']` });
      }}
    >
      <span>{label}</span>
      <input
        type="range"
        min={par.min}
        max={par.max}
        step={step}
        value={clamp(shown, par.min, par.max)}
        disabled={expressing}
        onChange={(event) => write(par.name, { value: Number(event.target.value) })}
      />
      <input
        className="par-num"
        type="number"
        value={typed ?? (Number.isFinite(shown) ? round(shown) : 0)}
        disabled={expressing}
        onChange={(event) => {
          const raw = event.target.value;
          setTyped(raw);
          // An empty or partial box ("", "-") is not a number yet; only commit real ones.
          const value = Number(raw);
          if (raw.trim() !== "" && Number.isFinite(value)) write(par.name, { value });
        }}
        onBlur={() => setTyped(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className={expressing ? "is-on" : ""}
        title="expression"
        onClick={() => {
          if (expressing) write(par.name, { mode: "constant", value: shown });
          else write(par.name, { mode: "expression", expr: par.expr || String(par.value) });
        }}
      >
        ƒ
      </button>
      {expressing && (
        <input
          className="par-expr"
          value={par.expr}
          spellCheck={false}
          onChange={(event) => {
            write(par.name, { expr: event.target.value });
            setTyping(true);
            window.clearTimeout(pause.current);
            pause.current = window.setTimeout(() => setTyping(false), 400);
          }}
          onBlur={() => {
            window.clearTimeout(pause.current);
            setTyping(false);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        />
      )}
      {error && <em>{error}</em>}
    </label>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
