import { useEffect, useRef, useState } from "react";
import { useAudio } from "../audio";
import { engine } from "../engine/engine";
import { useGraph } from "../store";

export function Viewer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const section = useRef<HTMLElement>(null);
  const node = useGraph((state) => state.nodes.find((item) => item.selected));
  const label = node?.data.label ?? "out";
  const source = useAudio((state) => state.source);
  const file = useAudio((state) => state.file);
  const listens = node?.data.kind === "audio" || (node?.data.kind === "op" && node.data.type === "audioband");
  const [full, setFull] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    engine.setViewer(canvas);
    return () => engine.setViewer(null);
  }, []);

  // Esc leaves fullscreen without going through the button, so follow the document.
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === section.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  function toggleFull(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void section.current?.requestFullscreen();
  }

  async function save(): Promise<void> {
    const blob = await engine.saveFrame();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = url;
    link.download = `patchwerk-${label}-${stamp}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="viewer" ref={section}>
      <header>
        <span>viewer</span>
        <b>{label}</b>
        {listens && (
          <em className="audio-hint" title="Pick the input in the header. It is this tab's own; others hear theirs.">
            hears {source === "off" ? "the test signal" : source === "mic" ? "your mic" : (file ?? "a file")}
          </em>
        )}
        <span className="viewer-actions">
          <button type="button" title="Save this frame as a PNG" onClick={() => void save()}>
            save image
          </button>
          <button type="button" title={full ? "Leave fullscreen (Esc)" : "Show the viewer fullscreen"} onClick={toggleFull}>
            {full ? "exit fullscreen" : "fullscreen"}
          </button>
        </span>
      </header>
      <canvas ref={ref} />
    </section>
  );
}
