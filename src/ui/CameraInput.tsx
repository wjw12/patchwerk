import { cameraOff, cameraOn, setMirror, useCamera } from "../camera";
import { readSession } from "../session";
import { useGraph } from "../store";

const LOCAL = "The camera is this browser tab's own: others in the room do not see it, and their webcam nodes show their own camera.";

/** The header's camera switch, shown while the graph has a webcam TOP. Per tab, never shared. */
export function CameraInput() {
  const on = useCamera((state) => state.on);
  const mirror = useCamera((state) => state.mirror);
  const status = useCamera((state) => state.status);
  const used = useGraph((state) => state.nodes.some((node) => node.data.kind === "webcam"));
  if (!used || readSession().fixed) return null;

  return (
    <div className={`audio-input is-${status}`} title={LOCAL}>
      <label>
        <span>camera</span>
        <select value={on ? "on" : "off"} onChange={(event) => (event.target.value === "on" ? void cameraOn() : cameraOff())}>
          <option value="off">off · test picture</option>
          <option value="on">on</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} />
        <span>mirror</span>
      </label>
      {status === "blocked" && <em>camera blocked</em>}
    </div>
  );
}
