// One Yjs update blob per room on disk. No database to operate.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "@hocuspocus/extension-database";

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function roomFile(dir: string, name: string): string | null {
  if (!SLUG.test(name)) return null;
  return path.join(dir, `${name}.yjs`);
}

export async function roomStore(dir: string): Promise<Database> {
  await mkdir(dir, { recursive: true });
  return new Database({
    fetch: async ({ documentName }) => {
      const file = roomFile(dir, documentName);
      if (!file) return null;
      const blob = Bun.file(file);
      if (!(await blob.exists())) return null;
      return new Uint8Array(await blob.arrayBuffer());
    },
    store: async ({ documentName, state }) => {
      const file = roomFile(dir, documentName);
      if (!file) return;
      await Bun.write(file, state);
    },
  });
}
