import { useEffect, useRef } from "react";
import { rewindAudio } from "../audio";
import { engine } from "../engine/engine";
import { readSession } from "../session";
import { useGraph } from "../store";

export function Playbar() {
  const playing = useGraph((state) => state.playing);
  const setPlaying = useGraph((state) => state.setPlaying);
  const fixed = readSession().fixed;
  const clock = useRef<HTMLSpanElement>(null);
  const stats = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (clock.current && !clock.current.textContent) clock.current.textContent = "absTime  0.00 s";
    if (stats.current && !stats.current.textContent) stats.current.textContent = "—";
  }, []);

  return (
    <div className="playbar">
      <button type="button" disabled={fixed} onClick={() => setPlaying(!playing)} title={playing ? "pause" : "play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <button type="button" disabled={fixed} onClick={() => {
          engine.resetClock();
          rewindAudio();
        }} title="reset time">
        ↺
      </button>
      <span id="abs-time" ref={clock} />
      <span id="stats" ref={stats} />
    </div>
  );
}
