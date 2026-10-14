# Patchwerk

Multi-player web generative art engine, in the spirit of TouchDesigner: a typed dataflow graph you can watch cook.

Operators belong to a family. A wire only connects two operators of the same family. Cross-family links are parameters.

- **TOP** — images on the GPU. A shader TOP is one GLSL ES 3.00 program into a float framebuffer. ShaderToy `mainImage` shaders paste in.
- **CHOP** — short numeric signals on the CPU.
- **POP** — point clouds on the GPU.
- **MAT** — how a POP is drawn.
- **COMP** — cameras and, later, nested networks.
- **DAT** — text and tables.

Cooking walks the wires. A node runs when an input, a parameter, or time changed. Cycles are rejected. `// @feedback` is the one legal loop: that node's previous frame comes back on `iChannel3`.

Textures stay on the GPU. One hidden WebGL2 canvas cooks every TOP. Node previews and the viewer are plain 2D canvases that copy that canvas in the same frame.

## Layout

- `src/engine` — ShaderToy wrapper, compile/test/commit, float framebuffers, audio texture
- `src/ui` — React Flow network, viewer, parameters, shader editor
- `src/store.ts` — graph, wires, parameters. zustand is what the engine reads every frame.
- `src/sync.ts` — mirrors the store into a Yjs room and back. `src/room.ts` picks the room and who you are.
- `server/` — the room server. Its own package, deployed on its own machine. See `docs/networking-plan.md`.

## Rooms

`/r/<slug>` is a room; `/` redirects to a fresh one. One Y.Doc per room, flat maps keyed by node id so every slider, position and wire is its own last-writer-wins key. Shader code is a `Y.Text` that CodeMirror binds to, so two people can type in one shader. Selection, compile status and node size stay local. Cursors over the viewer go through awareness into `iCursors[1..7]`.

`?graph=` / `?t=` / `?frame=` (the visual-test session) never joins a room.

## Now

Shader TOPs, an audio texture in ShaderToy's 512×2 layout, self-feedback, a network you can edit, and several people in one network. A new shader keeps the last good program until it compiles and a test frame looks alive.

## Next

LLM shader generation (`POST /api/shader`, deferred until the Agents SDK spec), image upload for a photo TOP, Caddy in front of the server for `wss://`.

## Development

Use bun: `bun install`, `bun run dev`, `bun test`.
Rooms need the server: `bun install --cwd server` once, then `bun run server` (port 3000, rooms in `server/data/rooms`). The client reads `VITE_SYNC_URL` (see `.env.example`); without it it uses `ws://<page host>:3000`.
`bun run check:shaders` compiles every `src/ops/**/*.glsl` in headless Edge (SwiftShader).
`bun run test:visual` compares one cooked frame to `tests/golden`. Update with `bun run test:visual -- --update <name>` only when the picture change is intentional.
`bun run test:room` opens two tabs in one room and checks they converge. Needs `bun run dev` and `bun run server`.
Do not write unit tests unless human instructs.
