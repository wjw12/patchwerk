// What the audio TOP and audioband CHOP listen to in this tab: nothing (a built-in test
// signal), the microphone, or an audio file that loops through the speakers. Audio is
// per client; nobody else in the room hears or sees this tab's input.
import { create } from "zustand";
import { engine } from "./engine/engine";
import { useGraph } from "./store";

export type AudioSource = "off" | "mic" | "file";

interface AudioState {
  source: AudioSource;
  /** "blocked": the mic was refused. "error": the file would not decode or play. */
  status: "idle" | "live" | "blocked" | "error";
  file: string | null;
}

export const useAudio = create<AudioState>(() => ({ source: "off", status: "idle", file: null }));

let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mic: { stream: MediaStream; node: MediaStreamAudioSourceNode } | null = null;
let track: { element: HTMLAudioElement; node: MediaElementAudioSourceNode; url: string } | null = null;

function ensureContext(): { context: AudioContext; analyser: AnalyserNode } {
  if (!context || !analyser) {
    context = new AudioContext();
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
  }
  return { context, analyser };
}

function stopMic(): void {
  if (!mic) return;
  mic.node.disconnect();
  for (const item of mic.stream.getTracks()) item.stop();
  mic = null;
}

function pauseFile(): void {
  track?.element.pause();
  track?.node.disconnect();
}

export async function listenToMic(): Promise<void> {
  const { context, analyser } = ensureContext();
  pauseFile();
  useAudio.setState({ source: "mic", status: "idle" });
  try {
    await context.resume();
    if (!mic) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Analysed only, never sent to the speakers: that would feed back.
      const node = context.createMediaStreamSource(stream);
      mic = { stream, node };
    }
    // Switched away while the permission prompt was up.
    if (useAudio.getState().source !== "mic") {
      stopMic();
      return;
    }
    mic.node.connect(analyser);
    engine.setAnalyser(analyser);
    useAudio.setState({ status: "live" });
  } catch {
    stopMic();
    engine.setAnalyser(null);
    useAudio.setState({ status: "blocked" });
  }
}

/** Loads a file and plays it on a loop; it follows the playbar's pause. */
export async function playFile(file: File): Promise<void> {
  const { context, analyser } = ensureContext();
  stopMic();
  pauseFile();
  if (track) URL.revokeObjectURL(track.url);
  const url = URL.createObjectURL(file);
  const element = new Audio(url);
  element.loop = true;
  // A media element can feed exactly one source node, so each file gets a fresh element.
  const node = context.createMediaElementSource(element);
  track = { element, node, url };
  useAudio.setState({ source: "file", status: "idle", file: file.name });
  await resumeFile();
}

async function resumeFile(): Promise<void> {
  if (!track || !context || !analyser) return;
  track.node.disconnect();
  track.node.connect(analyser);
  track.node.connect(context.destination);
  engine.setAnalyser(analyser);
  try {
    await context.resume();
    if (useGraph.getState().playing) await track.element.play();
    useAudio.setState({ status: "live" });
  } catch {
    useAudio.setState({ status: "error" });
  }
}

/** Switches back to the file already loaded; false when there is none yet. */
export function playLoadedFile(): boolean {
  if (!track) return false;
  stopMic();
  useAudio.setState({ source: "file" });
  void resumeFile();
  return true;
}

export function audioOff(): void {
  stopMic();
  pauseFile();
  engine.setAnalyser(null);
  useAudio.setState({ source: "off", status: "idle" });
}

/** The playbar's reset also rewinds the file. */
export function rewindAudio(): void {
  if (track) track.element.currentTime = 0;
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(file.name);
}

// The file pauses and plays with the playbar.
useGraph.subscribe((state, prev) => {
  if (state.playing === prev.playing || !track || useAudio.getState().source !== "file") return;
  if (state.playing) void track.element.play().catch(() => useAudio.setState({ status: "error" }));
  else track.element.pause();
});
