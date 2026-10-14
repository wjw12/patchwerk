// What the webcam TOP shows in this tab: a built-in test picture, or this tab's camera.
// Per client; nobody else in the room sees this tab's camera.
import { create } from "zustand";
import { engine } from "./engine/engine";

interface CameraState {
  on: boolean;
  mirror: boolean;
  /** "blocked": the camera was refused or is missing. */
  status: "idle" | "live" | "blocked";
}

export const useCamera = create<CameraState>(() => ({ on: false, mirror: true, status: "idle" }));

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;
let stream: MediaStream | null = null;

export async function cameraOn(): Promise<void> {
  useCamera.setState({ on: true, status: "idle" });
  try {
    stream ??= await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    // Switched off while the permission prompt was up.
    if (!useCamera.getState().on) return cameraOff();
    video.srcObject = stream;
    await video.play();
    engine.setCamera(video, useCamera.getState().mirror);
    useCamera.setState({ status: "live" });
  } catch {
    cameraOff();
    useCamera.setState({ status: "blocked" });
  }
}

export function cameraOff(): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  video.srcObject = null;
  engine.setCamera(null, useCamera.getState().mirror);
  useCamera.setState({ on: false, status: "idle" });
}

export function setMirror(mirror: boolean): void {
  useCamera.setState({ mirror });
  engine.setCamera(stream ? video : null, mirror);
}
