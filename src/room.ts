// Which room this tab is in (`/r/<slug>`) and who this tab is.

const ROOM = /^\/r\/([a-z0-9][a-z0-9-]{0,63})\/?$/;
const USER_KEY = "patchwerk.user";

export function roomFromUrl(): string | null {
  return ROOM.exec(location.pathname)?.[1] ?? null;
}

/** Returns the room slug, or null after redirecting `/` to a fresh room. */
export function ensureRoom(): string | null {
  const room = roomFromUrl();
  if (room) return room;
  location.replace(`/r/${randomSlug()}${location.search}`);
  return null;
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

function randomSlug(): string {
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)] as T;
  return `${pick(ADJ)}-${pick(NOUN)}-${Math.random().toString(36).slice(2, 6)}`;
}
