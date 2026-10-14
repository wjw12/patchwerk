// What a room can start from: blank, the demo and every example, as a grid of thumbnails.
// "new" mode links each tile to /new?from=<name>, so a click (or a middle click) opens a fresh
// room and never touches the current one. "replace" mode loads the template into this room.
import { useEffect, useRef } from "react";
import { buildGraph, EXAMPLES, templateFile, type GraphFile } from "../graph-file";
import { handOff, newSlug } from "../room";
import { importFile, loadGraphFile } from "./graph-io";

// cloud is the demo a room boots into, so it is not offered again as a template.
export const TEMPLATES: string[] = ["blank", ...EXAMPLES.map((example) => example.name).filter((name) => name !== "cloud")];

/** Thumbnails come from `bun run thumbs`, rendered from each example at a few seconds in. */
function Thumb({ name }: { name: string }) {
  if (name === "blank") return <span className="thumb is-blank">+</span>;
  return (
    <img
      className="thumb"
      src={`/thumbs/${name}.jpg`}
      alt=""
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

export function TemplateGrid({ onPick }: { onPick?: (name: string) => void }) {
  return (
    <div className="templates">
      {TEMPLATES.map((name) =>
        onPick ? (
          <button key={name} type="button" className="tile" onClick={() => onPick(name)}>
            <Thumb name={name} />
            <span>{name}</span>
          </button>
        ) : (
          <a key={name} className="tile" href={`/new?from=${encodeURIComponent(name)}`}>
            <Thumb name={name} />
            <span>{name}</span>
          </a>
        ),
      )}
    </div>
  );
}

/** Opens a .json graph in a brand-new room: the graph rides along in localStorage. */
export async function openFileInNewRoom(file: File): Promise<void> {
  let parsed: GraphFile;
  try {
    parsed = JSON.parse(await file.text()) as GraphFile;
    buildGraph(parsed);
  } catch (error) {
    window.alert(`${file.name} is not a patchwerk graph: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const room = newSlug();
  handOff(room, parsed);
  location.assign(`/r/${room}`);
}

export function FileButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

export function TemplatePicker({ mode, onClose }: { mode: "new" | "replace"; onClose: () => void }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const replace = async (name: string) => {
    const file = await templateFile(name);
    if (file && loadGraphFile(file, `the ${name} template`)) onClose();
  };

  return (
    <div className="picker-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="picker" role="dialog" aria-label={mode === "new" ? "new room" : "replace this room's graph"}>
        <header>
          <h2>{mode === "new" ? "New room" : "Replace this room's graph"}</h2>
          <p>
            {mode === "new"
              ? "Pick a starting point. It opens in a fresh room with its own link; this room stays as it is."
              : "Everyone in this room sees the new graph. Ctrl+Z brings the old one back."}
          </p>
          <button type="button" className="close" title="close (Esc)" onClick={onClose}>
            ×
          </button>
        </header>
        <TemplateGrid onPick={mode === "replace" ? (name) => void replace(name) : undefined} />
        <footer>
          <FileButton
            label="open a .json file…"
            onFile={(file) => {
              if (mode === "new") void openFileInNewRoom(file);
              else void importFile(file).then((done) => done && onClose());
            }}
          />
        </footer>
      </section>
    </div>
  );
}
