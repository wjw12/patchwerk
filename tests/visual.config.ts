import { CAPTURE_H, CAPTURE_W } from "../src/capture";

export const region = { width: CAPTURE_W, height: CAPTURE_H };

// Max per-channel difference, 0–255, on the center 256×256 of the `out` node.
// The read is RGBA16F from that node's framebuffer, quantized to 8-bit.
export const tolerance = 2;

export interface VisualCase {
  name: string;
  graph: string;
  t: number;
  frame: number;
}

export const cases: VisualCase[] = [
  { name: "warp", graph: "/tests/graphs/warp.json", t: 1.25, frame: 1 },
  { name: "template", graph: "/tests/graphs/template.json", t: 0.8, frame: 1 },
  { name: "melt-clear", graph: "/tests/graphs/melt.json", t: 0.5, frame: 1 },
  { name: "melt-feedback", graph: "/tests/graphs/melt.json", t: 2, frame: 120 },
];
