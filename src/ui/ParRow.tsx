import { useState } from "react";
import { useLive } from "../engine/live";
import { useGraph, type Par } from "../store";

export function ParRow({ id, par }: { id: string; par: Par }) {
  const setOpPar = useGraph((state) => state.setOpPar);
  if (par.kind === "menu") {
    return (
      <label className="par-row">
        <span>{par.name}</span>
        <select value={par.value} onChange={(event) => setOpPar(id, par.name, { menu: event.target.value })}>
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
        <span>{par.name}</span>
        <input value={par.value} onChange={(event) => setOpPar(id, par.name, { text: event.target.value })} />
      </label>
    );
  }
  return <NumberRow id={id} par={par} />;
}

function NumberRow({ id, par }: { id: string; par: Extract<Par, { kind: "number" }> }) {
  const setOpPar = useGraph((state) => state.setOpPar);
  const live = useLive(id, par.name);
  const expressing = par.mode === "expression";
  const shown = expressing ? (live?.cooked ?? par.value) : par.value;
  const error = expressing ? (live?.error ?? null) : null;
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
        const label = event.dataTransfer.getData("application/x-patchwerk-chop");
        if (!label) return;
        event.preventDefault();
        setOpPar(id, par.name, { mode: "expression", expr: `op('${label}')['chan1']` });
      }}
    >
      <span>{par.name}</span>
      <input
        type="range"
        min={par.min}
        max={par.max}
        step={step}
        value={clamp(shown, par.min, par.max)}
        disabled={expressing}
        onChange={(event) => setOpPar(id, par.name, { value: Number(event.target.value) })}
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
          if (raw.trim() !== "" && Number.isFinite(value)) setOpPar(id, par.name, { value });
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
          if (expressing) setOpPar(id, par.name, { mode: "constant", value: shown });
          else setOpPar(id, par.name, { mode: "expression", expr: par.expr || String(par.value) });
        }}
      >
        ƒ
      </button>
      {expressing && (
        <input
          className="par-expr"
          value={par.expr}
          spellCheck={false}
          onChange={(event) => setOpPar(id, par.name, { expr: event.target.value })}
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
