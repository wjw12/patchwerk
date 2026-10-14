import { useEffect, useRef } from "react";
import { engine } from "../engine/engine";
import { useGraph } from "../store";

export function Viewer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const label = useGraph((state) => state.nodes.find((node) => node.selected)?.data.label ?? "out");
  const mic = useGraph((state) => state.mic);

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
        <button type="button" onClick={() => void engine.enableMic()}>
          {mic === "live" ? "mic live" : mic === "denied" ? "mic blocked" : "enable mic"}
        </button>
      </header>
      <canvas ref={ref} />
    </section>
  );
}
