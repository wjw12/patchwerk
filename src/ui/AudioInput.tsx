import { useRef } from "react";
import { audioOff, listenToMic, playFile, playLoadedFile, useAudio } from "../audio";
import { readSession } from "../session";

const LOCAL = "Audio input is this browser tab's own: others in the room do not hear it, and their audio nodes follow their own input.";

/** The header's audio input: off (test signal), mic, or a looping file. Per tab, never shared. */
export function AudioInput() {
  const source = useAudio((state) => state.source);
  const status = useAudio((state) => state.status);
  const file = useAudio((state) => state.file);
  const picker = useRef<HTMLInputElement>(null);
  if (readSession().fixed) return null;

  const note = status === "blocked" ? "mic blocked" : status === "error" ? "can't play" : source === "file" ? file : null;

  return (
    <div className={`audio-input is-${source} is-${status}`} title={LOCAL}>
      <label>
        <span>audio</span>
        <select
          value={source}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "off") audioOff();
            else if (next === "mic") void listenToMic();
            else if (!playLoadedFile()) picker.current?.click();
          }}
        >
          <option value="off">off · test signal</option>
          <option value="mic">mic</option>
          <option value="file">file</option>
        </select>
      </label>
      {source === "file" && (
        <button type="button" title="pick another audio file (or drop one on the network)" onClick={() => picker.current?.click()}>
          {note ?? "pick…"}
        </button>
      )}
      {source !== "file" && note && <em>{note}</em>}
      <em className="local">this tab</em>
      <input
        ref={picker}
        type="file"
        accept="audio/*"
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) void playFile(picked);
        }}
      />
    </div>
  );
}
