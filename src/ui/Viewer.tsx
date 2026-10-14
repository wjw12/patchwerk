import { useEffect, useRef } from "react";
import { useAudio } from "../audio";
import { engine } from "../engine/engine";
import { useGraph } from "../store";

export function Viewer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const node = useGraph((state) => state.nodes.find((item) => item.selected));
  const label = node?.data.label ?? "out";
  const source = useAudio((state) => state.source);
  const file = useAudio((state) => state.file);
  const listens = node?.data.kind === "audio" || (node?.data.kind === "op" && node.data.type === "audioband");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    engine.setViewer(canvas);
    return () => engine.setViewer(null);
  }, []);

  return (
    <section className="viewer">
      <header>
        <span>viewer</span>
        <b>{label}</b>
        {listens && (
          <em className="audio-hint" title="Pick the input in the header. It is this tab's own; others hear theirs.">
            hears {source === "off" ? "the test signal" : source === "mic" ? "your mic" : (file ?? "a file")}
          </em>
        )}
      </header>
      <canvas ref={ref} />
    </section>
  );
}
