// Per-frame cooked parameter values. Kept off the graph store so a moving
// absTime expression does not rewrite Yjs every frame.

import { useEffect, useState } from "react";

export interface LiveValue {
  cooked: number;
  error: string | null;
}

const values = new Map<string, LiveValue>();
const listeners = new Set<() => void>();
let scheduled = false;

function key(id: string, name: string): string {
  return `${id}/${name}`;
}

export function setLive(id: string, name: string, cooked: number, error: string | null): void {
  const prev = values.get(key(id, name));
  if (prev && prev.cooked === cooked && prev.error === error) return;
  values.set(key(id, name), { cooked, error });
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const listener of listeners) listener();
  });
}

export function getLive(id: string, name: string): LiveValue | undefined {
  return values.get(key(id, name));
}

export function clearLive(id: string): void {
  for (const entry of [...values.keys()]) {
    if (entry.startsWith(`${id}/`)) values.delete(entry);
  }
}

export function useLive(id: string, name: string): LiveValue | undefined {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return values.get(key(id, name));
}
