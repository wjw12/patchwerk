// Which room this tab is in (`/r/<slug>`), how a new one starts, and who this tab is.

const ROOM = /^\/r\/([a-z0-9][a-z0-9-]{0,63})\/?$/;
const USER_KEY = "patchwerk.user";

export function roomFromUrl(): string | null {
  return ROOM.exec(location.pathname)?.[1] ?? null;
}

/**
 * Where a room starts from when it is empty: a template name from `?from=` (an example, `blank`
 * or `demo`), or a graph handed over by duplicate / open file. `/new?from=x` makes a fresh slug.
 */
export function newRoomPath(from?: string): string {
  return `/r/${newSlug()}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
}

/** `/new` and `/new?from=hydra`: a fresh room every time, so a shared link never overwrites one. */
export function isNewRoomPath(): boolean {
  return /^\/new\/?$/.test(location.pathname);
}

const SEED_KEY = "patchwerk.seed.";

/** Hands a graph to a room this browser is about to open (duplicate, open file). */
export function handOff(room: string, graph: unknown): void {
  try {
    localStorage.setItem(SEED_KEY + room, JSON.stringify(graph));
  } catch {
    // storage full or blocked: the new room starts from the demo instead
  }
}

export function takeHandOff(room: string): unknown {
  try {
    const raw = localStorage.getItem(SEED_KEY + room);
    if (raw == null) return null;
    localStorage.removeItem(SEED_KEY + room);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const RECENT_KEY = "patchwerk.recent";

export interface RecentRoom {
  room: string;
  at: number;
}

export function recentRooms(): RecentRoom[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentRoom[];
    return Array.isArray(list) ? list.filter((item) => typeof item.room === "string" && typeof item.at === "number") : [];
  } catch {
    return [];
  }
}

export function rememberRoom(room: string): void {
  const list = [{ room, at: Date.now() }, ...recentRooms().filter((item) => item.room !== room)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private mode: no history
  }
}

export function forgetRoom(room: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentRooms().filter((item) => item.room !== room)));
  } catch {
    // ignore
  }
}

export function roomUrl(room: string): string {
  return `${location.origin}/r/${room}`;
}

export interface Identity {
  id: string;
  name: string;
  color: string;
}

const COLORS = ["#8d7cff", "#3dcf8a", "#e0a35a", "#ff6f91", "#4cc9f0", "#f9c74f", "#b5e48c", "#f4978e"];
const ADJ = ["quiet", "brisk", "loud", "soft", "wild", "tidy", "odd", "warm"];
const NOUN = ["fox", "moth", "heron", "otter", "lynx", "newt", "wren", "yak"];

export function identity(): Identity {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return JSON.parse(raw) as Identity;
  } catch {
    // fall through to a new identity
  }
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)] as T;
  const me: Identity = {
    id: crypto.randomUUID().slice(0, 8),
    name: `${pick(ADJ)} ${pick(NOUN)}`,
    color: pick(COLORS),
  };
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(me));
  } catch {
    // private mode: identity lives for this tab only
  }
  return me;
}

export function newSlug(): string {
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)] as T;
  return `${pick(ADJ)}-${pick(NOUN)}-${Math.random().toString(36).slice(2, 6)}`;
}
