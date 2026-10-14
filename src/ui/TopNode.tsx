import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { engine } from "../engine/engine";
import type { PNode } from "../store";

const FAMILY = {
  TOP: { header: "#2a2460", accent: "#8d7cff" },
  CHOP: { header: "#164c36", accent: "#3dcf8a" },
};

export function TopNode({ id, data, selected }: NodeProps<PNode>) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    engine.setPreview(id, canvas);
    return () => engine.setPreview(id, null);
  }, [id]);

  const tone = FAMILY[data.family];
  const channels = data.kind === "out" ? [0] : data.kind === "shader" ? data.channels : [];
  const bad = data.kind === "shader" && data.status === "error";
  const live = data.kind !== "shader" || data.status === "live";

  return (
    <div className={`top-node${selected ? " is-selected" : ""}${bad ? " is-error" : ""}`}>
      <header style={{ background: tone.header }}>
        <b>{data.label}</b>
        <span>{data.kind === "audio" ? "512×2" : data.kind === "shader" && data.feedback ? "feedback" : data.family}</span>
        <i className={live && !bad ? "ok" : "bad"} />
      </header>
      <canvas ref={ref} width={160} height={90} />
      {channels.map((channel, index) => (
        <Handle
          key={channel}
          type="target"
          id={`ch${channel}`}
          position={Position.Left}
          style={{ top: 58 + index * 16, background: tone.accent }}
        />
      ))}
      {channels.map((channel, index) => (
        <em key={channel} className="port-label" style={{ top: 50 + index * 16 }}>
          {channel}
        </em>
      ))}
      <Handle type="source" id="out" position={Position.Right} style={{ background: tone.accent }} />
      {bad && data.error && <p>{data.error.split("\n")[0]}</p>}
    </div>
  );
}
