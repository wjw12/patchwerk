# Networking: multiplayer rooms

Hackathon scope: the simplest thing that works. Versions verified against npm on 2026-10-14. Sections 1–5 describe what is built; §6 is what was cut and why.

---

## 0. Decisions

| Decision | Choice | Why |
|---|---|---|
| Sync engine | **Yjs 13.6.x + Hocuspocus 4.7.x**, one Bun process | Convergence, reconnect, offline buffering and presence come free. Collaborative GLSL text needs a CRDT anyway. |
| Runtime | **Bun** (`Bun.serve` websockets + the `Hocuspocus` core class) | No Node, Express or crossws. Bun's socket already has the `send/close/readyState` shape Hocuspocus wants. |
| Persistence | **One Yjs update file per room** via `@hocuspocus/extension-database` | Nothing native, nothing to operate. `server/data/rooms/<slug>.yjs`. |
| Doc schema | **Flat maps keyed by node id**, mirrored from zustand | Every slider, position and wire is its own last-writer-wins key. No nested Y.Maps, no React-Yjs library. |
| Shader code | `Y.Text` per node + `y-codemirror.next` | Two people type in one shader; remote carets; per-user undo. |
| Ephemeral state | Yjs awareness | Who is here, who is editing which node, pointer over the viewer → `iCursors`. |
| Addressing | `VITE_SYNC_URL`, server allows any origin | Frontend is static and hosted anywhere; the server is its own box. |
| Rooms | `/r/<slug>`; `/` redirects to a random slug | Share the link. |

**Not used:** any `@y/*` v14 prerelease, SQLite, Express, Socket.IO, a custom op protocol, server-side validation, accounts, undo across sessions.
`yjs` is pinned to 13.6.33 in both packages; mixing a 14 prerelease anywhere breaks sync silently.

---

## 1. Server (`server/`)

Its own package with its own lockfile so it can live on another machine.

```
bun install --cwd server
bun run server            # = bun run --cwd server dev, port 3000
PORT=…  DATA_DIR=…        # defaults 3000 and ./data/rooms
GET /health               # { ok, rooms: [{ name, clients }] }
```

- `index.ts`: `Bun.serve`; any websocket upgrade goes to `hocuspocus.handleConnection(ws, request)`. `onAuthenticate` accepts everyone.
- `rooms.ts`: `extension-database` with `fetch`/`store` on `Bun.file`. Room names are validated against `^[a-z0-9][a-z0-9-]{0,63}$`.
- Shutdown closes connections, flushes the debounced stores and waits for documents to unload before exiting, so the last 2 s of edits persist.

## 2. Doc schema

```
nodes      id          -> { kind: 'shader'|'audio'|'out', label, x, y }
code       id          -> Y.Text            // shader draft, CodeMirror binds to it
committed  id          -> string            // last program that compiled and passed the test frame
params     "id/name"   -> number | [r,g,b]  // values only; min/max/label are parsed from the code
edges      id          -> { source, target, targetHandle }   // id is React Flow's deterministic xy-edge__…
```

Local only, never in the doc: `selected`, `measured`, `dragging`, compile `status`/`error`, edge style, param schema.

Awareness per client: `user {id, name, color, colorLight}`, `cursor {x, y, down} | null` (viewer space, y up), `editing: nodeId | null`.

## 3. Client (`src/sync.ts`)

zustand stays the render state; the engine reads it every frame and never learned about Yjs.

- **Local → doc.** `useGraph.subscribe` diffs `nodes`/`edges` against the previous state and writes only fields that differ from the doc, in one transaction with origin `LOCAL`. Every store action (add, drag, connect, delete, reset, load) syncs without its own code path. A drag tick is one `nodes[id]` write.
- **Doc → local.** `doc.on('update')` with a non-local origin schedules one `pull()` per microtask. It rebuilds `PNode`s from the maps, re-parses a draft only when its text changed, keeps the local position while this client is mid-drag, and reuses the previous node object when nothing changed so React Flow doesn't re-render.
- **Seeding.** Before the first `synced`, local edits are not pushed. On sync, an empty room is seeded from the local graph (demo or last save); otherwise the room replaces the local graph.
- **Conflicts.** Two clients can each make a locally valid wire that together form a cycle or double up a channel. `pruneEdges` drops the loser deterministically (sorted by id) on every client and deletes it from the doc.
- **`committed` is shared** so a joiner whose room has a broken draft still renders the last good program. Each client compiles the draft itself; the one that succeeds writes `committed`.
- **Editor.** `CodeView` builds an `EditorView` from `ytext.toString()` with `yCollab(ytext, awareness)`; the controlled `@uiw/react-codemirror` is gone. Leva panels follow remote values through `set()` and only write back on `fromPanel`.
- **Cursors.** `engine.onPointer` publishes the viewer pointer to awareness (rAF-throttled); `engine.setRoomCursors` packs remote cursors after the local one into `iCursors`, with `iCursorCount` the total.

## 4. Local development

Two processes: `bun run dev` (Vite, 5173) and `bun run server` (3000). Open `http://localhost:5173/`, copy the room link from the header into a second tab. Phones on the LAN work because the client defaults to `ws://<page host>:3000`.

`bun run test:room` drives two headless tabs through seed → presence → add → type → compile → drag → reload.

## 5. Deployment

Frontend: `bun run build`, host `dist/` anywhere with SPA fallback for `/r/*`. Set `VITE_SYNC_URL=wss://rooms.example.com` at build time.

Server: `bun run --cwd server start` under systemd or pm2 with a `Caddyfile`:
```
rooms.example.com {
  reverse_proxy localhost:3000
}
```
Caddy gets a certificate and proxies websockets with no extra config. `wss://` is mandatory from an HTTPS page; a mixed-content block looks like "server unreachable". Back up `server/data/` if rooms should survive the box.

## 6. Cut, and when to bring it back

- **LLM endpoint** (`POST /api/shader`, SSE) — waits on the Agents SDK spec. Add it as a route in `server/index.ts`; the generate → compile → commit loop runs in the prompting browser and lands in `code`/`committed` like any edit. The AI appears as a participant through awareness.
- **Image upload** — no photo TOP yet. When there is one: `POST /api/upload`, sha256-named file, URL in a node field, same-origin or `crossOrigin='anonymous'`.
- **Drag/scrub ghosts in awareness** — positions and slider values are written straight to the doc at pointer rate. Fine at hackathon scale; move to awareness if doc traffic ever matters.
- **Auth, rate limits, per-room epochs for `iTime`** — none needed for the demo.

## 7. Gotchas

- `yjs` must be one copy and 13.x in both packages.
- Seed only after `synced`; seeding an already-populated room clobbers it.
- Never bind CodeMirror through a controlled `value` prop alongside `yCollab`: the initial dispatch gets written back into the Y.Text and doubles the document.
- Awareness marks a peer offline after 30 s silence; the provider heartbeats, don't add your own.
- Hocuspocus drops a client it hasn't heard from in 60 s; Bun's `idleTimeout` is set above that.
- A `pull()` during a local drag must keep the local position or React Flow fights the remote value.
