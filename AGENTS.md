# Patchwerk

Multi-player web generative art engine, in the spirit of TouchDesigner: a typed dataflow graph you can watch cook.

Operators belong to a family. A wire only connects two operators of the same family. Cross-family links are parameters.

- **TOP** — images on the GPU. A shader TOP is one GLSL ES 3.00 program into a float framebuffer. ShaderToy `mainImage` shaders paste in.
- **CHOP** — short numeric signals on the CPU.
- **POP** — point clouds on the GPU.
- **MAT** — how a POP is drawn.
- **COMP** — cameras and, later, nested networks.
- **DAT** — text and tables.

Cooking walks the wires. A node runs when an input, a parameter, or time changed. Cycles are rejected. The legal loops read last frame: `// @feedback` brings a node's own previous frame back on `iChannel3`, and `// @prev iChannel1 bufB` binds another shader TOP's (or `self`'s) previous frame, so ShaderToy buffers can read each other.

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

The boot graph is a POP cloud. CHOP lfo, pattern, audioband, math, and null cook one sample per frame on the CPU. Expressions (`absTime.seconds`, `op('name')['chan1']`, `+ - * /`, `sin`, `fract`, `mod` and a few more) are evaluated on the CPU and can point at a CHOP by its label. POP pointgen, noise, mathmix, mathcombine, and transform cook as RGBA32F textures, one texel per point. A point MAT draws them additively into a render TOP, then bloom, then out. The playbar pauses `absTime`. The viewer follows the selection. ShaderToy TOPs, audio, and `// @feedback` still cook; load that graph with `?graph=/tests/graphs/melt.json`.

## Next

More POP generators, a GLSL MAT, and DAT text for shader bodies. Networking stays on the current document until it is updated for these families.

## Development

Use bun: `bun install`, `bun run dev`, `bun test`.
Rooms need the server: `bun install --cwd server` once, then `bun run server` (port 3000, rooms in `server/data/rooms`). The client reads `VITE_SYNC_URL` (see `.env.example`); without it it uses `ws://<page host>:3000`.
`bun run check:shaders` compiles every `src/ops/**/*.glsl` in headless Edge (SwiftShader).
`bun run test:visual` compares one cooked frame to `tests/golden`. Update with `bun run test:visual -- --update <name>` only when the picture change is intentional.
`bun run test:room` opens two tabs in one room and checks they converge. Needs `bun run dev` and `bun run server`.
Do not write unit tests unless human instructs.
