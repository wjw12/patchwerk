export interface Probe {
  ready: boolean;
  error: string | null;
  width: number;
  height: number;
  rgba: string;
}

declare global {
  interface Window {
    __patchwerk?: Probe;
  }
}

export function publish(probe: Probe): void {
  window.__patchwerk = probe;
}

export function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}
