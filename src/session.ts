export interface Launch {
  graph: string | null;
  t: number;
  frames: number;
  fixed: boolean;
  viewer: string;
}

export function readSession(): Launch {
  const query = new URLSearchParams(location.search);
  const graph = query.get("graph");
  const tRaw = query.get("t");
  const frameRaw = query.get("frame");
  const fixed = graph != null || tRaw != null || frameRaw != null;
  const t = tRaw == null ? 0 : Number(tRaw);
  const frames = frameRaw == null ? 1 : Math.floor(Number(frameRaw));
  if (fixed && !Number.isFinite(t)) throw new Error(`?t=${tRaw} is not a number`);
  if (fixed && (!Number.isFinite(frames) || frames < 1)) throw new Error(`?frame=${frameRaw} must be an integer >= 1`);
  return { graph, t, frames, fixed, viewer: "out" };
}
