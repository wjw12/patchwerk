import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLive } from "../engine/live";
import type { NumberPar, ParOverride, TextPar } from "../ops/catalog";
import { useGraph, type Par } from "../store";

type ParPatch = ParOverride & { text?: string; menu?: string };
/** Where a row writes. Ops default to setOpPar; a shader TOP passes its own setter. */
export type ParSetter = (name: string, patch: ParPatch) => void;

export function ParRow({ id, par, label, set }: { id: string; par: Par; label?: string; set?: ParSetter }) {
  const setOpPar = useGraph((state) => state.setOpPar);
  const write: ParSetter = set ?? ((name, patch) => setOpPar(id, name, patch));
  if (par.kind === "menu") {
    return (
      <label className="par-row" title={par.name}>
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
  if (par.kind === "text" && par.ref && !par.ref.pattern) return <RefRow par={par} label={label ?? par.name} write={write} />;
  if (par.kind === "text") {
    return (
      <label className="par-row" title={par.name}>
        <span>{label ?? par.name}</span>
        <input value={par.value} spellCheck={false} onChange={(event) => write(par.name, { text: event.target.value })} />
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
      title={par.name}
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

/** A name parameter (geo.pop, render.geo, ...): pick from the ops that fit. A name that no longer fits stays listed. */
function RefRow({ par, label, write }: { par: TextPar; label: string; write: ParSetter }) {
  const want = par.ref;
  const options = useGraph((state) =>
    state.nodes
      .filter((node) => want && node.data.family === want.family && (!want.type || (node.data.kind === "op" && node.data.type === want.type)))
      .map((node) => node.data.label)
      .join("\n"),
  );
  const labels = options ? options.split("\n") : [];
  const missing = par.value !== "" && !labels.includes(par.value);
  return (
    <label className="par-row" title={par.name}>
      <span>{label}</span>
      <select className={missing ? "is-missing" : undefined} value={par.value} onChange={(event) => write(par.name, { text: event.target.value })}>
        <option value="">—</option>
        {missing && <option value={par.value}>{par.value} (missing)</option>}
        {labels.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * tx ty tz or colorr colorg colorb on one row, as TD lays them out. Each field takes a number or an
 * expression; drag its letter to scrub. A color row adds a swatch.
 */
export function VectorRow({ id, label, pars, color, set }: { id: string; label: string; pars: NumberPar[]; color: boolean; set?: ParSetter }) {
  const setOpPar = useGraph((state) => state.setOpPar);
  const write: ParSetter = set ?? ((name, patch) => setOpPar(id, name, patch));
  return (
    <div className={`par-row par-vector${color ? " is-color" : ""}`} title={pars.map((par) => par.name).join(" ")}>
      <span>{label}</span>
      <div className="vec-fields" style={{ gridTemplateColumns: `repeat(${pars.length}, minmax(0, 1fr))` }}>
        {pars.map((par) => (
          <VecField key={par.name} id={id} par={par} write={write} />
        ))}
      </div>
      {color ? <Swatch id={id} pars={pars} write={write} /> : <i />}
    </div>
  );
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function VecField({ id, par, write }: { id: string; par: NumberPar; write: ParSetter }) {
  const live = useLive(id, par.name);
  const expressing = par.mode === "expression";
  const [typed, setTyped] = useState<string | null>(null);
  const scrub = useRef<{ x: number; value: number; moved: boolean } | null>(null);
  const shown = expressing ? (live?.cooked ?? par.value) : par.value;
  const error = expressing && typed === null ? (live?.error ?? null) : null;
  const span = par.max - par.min;

  function commit(raw: string): void {
    const text = raw.trim();
    if (text === "") return;
    if (NUMBER.test(text)) write(par.name, { mode: "constant", value: snap(Number(text)) });
    else write(par.name, { mode: "expression", expr: text });
  }

  function snap(value: number): number {
    return par.step === 1 ? Math.round(value) : value;
  }

  const onDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || expressing) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = { x: event.clientX, value: par.value, moved: false };
  };
  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = scrub.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < 2 && !start.moved) return;
    start.moved = true;
    // The whole slider range over 300 px; shift for a tenth of that.
    const rate = (span / 300) * (event.shiftKey ? 0.1 : 1);
    write(par.name, { value: snap(start.value + dx * rate) });
  };

  return (
    <span
      className={`vec-field${expressing ? " is-expr" : ""}${error ? " is-error" : ""}`}
      title={expressing ? `${par.name} = ${par.expr} → ${round(shown)}${error ? `\n${error}` : ""}` : `${par.name}: drag the letter, or type a number or an expression`}
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
      <b onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (scrub.current = null)} onPointerCancel={() => (scrub.current = null)}>
        {par.name.slice(-1)}
      </b>
      <input
        value={typed ?? (expressing ? par.expr : String(round(par.value)))}
        spellCheck={false}
        inputMode={expressing ? "text" : "decimal"}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const raw = event.target.value;
          setTyped(raw);
          // A number lands as it is typed; an expression waits for Enter or leaving the field.
          if (!expressing && NUMBER.test(raw.trim())) write(par.name, { value: snap(Number(raw)) });
        }}
        onBlur={(event) => {
          if (typed !== null) commit(event.currentTarget.value);
          setTyped(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setTyped(null);
            requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
          }
        }}
      />
    </span>
  );
}

/** Picks a color for the three channels. Above 1 (HDR) the picked hue keeps the brightest channel's level. */
function Swatch({ id, pars, write }: { id: string; pars: NumberPar[]; write: ParSetter }) {
  const r = useLive(id, pars[0]?.name ?? "");
  const g = useLive(id, pars[1]?.name ?? "");
  const b = useLive(id, pars[2]?.name ?? "");
  const now = pars.map((par, index) => (par.mode === "expression" ? ([r, g, b][index]?.cooked ?? par.value) : par.value)) as [number, number, number];
  const level = Math.max(1, ...now);
  return (
    <input
      type="color"
      className="par-color"
      title="pick a color; the channels above stay editable and can go past 1"
      value={rgbHex([now[0] / level, now[1] / level, now[2] / level])}
      onChange={(event) => {
        const rgb = hexRgb(event.target.value);
        pars.forEach((par, index) => write(par.name, { mode: "constant", value: round(rgb[index]! * level) }));
      }}
    />
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
