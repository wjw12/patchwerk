# Patchwerk

Multi-player web generative art engine, in the spirit of TouchDesigner: a typed dataflow graph you can watch cook.

Operators belong to a family. A wire only connects two operators of the same family. Cross-family links are parameters.

- **TOP** — images on the GPU. A shader TOP is one GLSL ES 3.00 program into a float framebuffer. ShaderToy `mainImage` shaders paste in.
- **CHOP** — short numeric signals on the CPU.
- **POP** — point clouds on the GPU.
- **MAT** — how a POP is drawn: point (additive glow) or phong (lit spheres).
- **COMP** — cameras, lights, geos and, later, nested networks.
- **DAT** — text and tables.

Cooking walks the wires. A node runs when an input, a parameter, or time changed. Cycles are rejected. The legal loops read last frame: `// @feedback` brings a node's own previous frame back on `iChannel3`, and `// @prev iChannel1 bufB` binds another shader TOP's (or `self`'s) previous frame, so ShaderToy buffers can read each other.

Textures stay on the GPU. One hidden WebGL2 canvas cooks every TOP. Node previews and the viewer are plain 2D canvases that copy that canvas in the same frame.

## Layout

- `src/engine` — ShaderToy wrapper, compile/test/commit, float framebuffers, audio texture
- `src/ui` — React Flow network, viewer, parameters, shader editor
- `src/store.ts` — graph, wires, parameters. zustand is what the engine reads every frame.
- `src/sync.ts` — mirrors the store into a Yjs room and back. `src/room.ts` picks the room and who you are.
- `server/` — the room server. Its own package, deployed on its own machine. See `docs/networking-plan.md`.
- `src/ai` — the assistant: `protocol.ts` (frames), `execute.ts` (the nine tools, run in the asking tab), `client.ts` (the `useAssistant` store). `src/ui/Assistant.tsx` is the panel. `server/ai.ts` runs the Claude Agent SDK session. See `docs/ai-plan.md`.

## Rooms

`/r/<slug>` is a room. `/` is the landing page: templates and this browser's recent rooms. `/new?from=<template>` opens a fresh room seeded from a template (`blank`, `demo`, or any `tests/graphs` example); share that link when every visitor should get their own copy. One Y.Doc per room, flat maps keyed by node id so every slider, position and wire is its own last-writer-wins key. Shader code is a `Y.Text` that CodeMirror binds to, so two people can type in one shader. Selection, compile status and node size stay local. Cursors over the viewer go through awareness into `iCursors[1..7]`.

Ctrl+Z undoes only your own graph edits. The room chip in the header is the room menu: copy link, new room, duplicate, export, and (demoted, with a confirm) replace this room's graph with a template or file. Template thumbnails are `public/thumbs/<name>.jpg`; regenerate with `bun run thumbs` (needs `bun run dev`) after adding or changing an example. Audio input (off, mic, or a looping file) is per tab and never shared.

`?graph=` / `?t=` / `?frame=` (the visual-test session) never joins a room.

## Assistant

The collapsible panel on the left talks to `/ai` on the room server, which holds the Anthropic key and runs one Claude Agent SDK session per websocket, one per room. The agent's tools (`get_graph`, `read_shader`, `write_shader`, `set_param`, `add_node`, `connect`, `disconnect`, `edit_node`, `view`) are RPC'd back to the asking tab and run against the store and engine there, so its edits reach the room like any human edit and `view` sees the real GPU output. The tab must stay in the foreground: a background tab cooks no frames. The system prompt is `server/prompt.txt` with the catalog from `catalogText()`. `server/.env` needs `ANTHROPIC_API_KEY` (see `server/.env.example`); `AI_MODEL`, `AI_BUDGET_USD` and `AI_TOKEN` are optional. `bun run --cwd server check:ai` is the one-turn smoke test of the SDK under Bun; `bun run smoke:ai` drives a real goal through a headless tab (needs dev + server, costs real money).

## Now

The boot graph is a POP cloud. CHOP lfo, pattern, audioband, math, and null cook one sample per frame on the CPU. Expressions (`absTime.seconds`, `op('name')['chan1']`, `+ - * /`, `sin`, `fract`, `mod` and a few more) are evaluated on the CPU and can point at a CHOP by its label. POP pointgen, noise, mathmix, mathcombine, and transform cook as RGBA32F textures, one texel per point. A point MAT draws them additively into a render TOP, then bloom, then out; a phong MAT ray-traces each point as a sphere of world-unit radius with true depth, lit by light COMPs (point, distant, cone, ambient) that the render TOP picks with its `lights` pattern. The playbar pauses `absTime`. The viewer follows the selection. ShaderToy TOPs, audio, and `// @feedback` still cook; load that graph with `?graph=/tests/graphs/melt.json`.

## Next

More POP generators, a GLSL MAT, and DAT text for shader bodies. The assistant's catalog is `catalogText()`: a new op or parameter needs a `DESCRIBE` line and, if its parameters are not obvious, a `PAR_NOTES` line. Networking stays on the current document until it is updated for these families.

## Development

Use bun: `bun install`, `bun run dev`, `bun test`.
Rooms need the server: `bun install --cwd server` once, then `bun run server` (port 3000, rooms in `server/data/rooms`). The client reads `VITE_SYNC_URL` (see `.env.example`); without it it uses `wss://<page host>/sync` on HTTPS and `ws://<page host>:3000` on HTTP.
`bun run dev:remote` runs the local frontend against the deployed room server. Deployed at https://patchwerk.heurist.xyz; see `docs/networking-plan.md` §5 and `deploy/`.
How to test, and which tier to reach for: [docs/testing.md](docs/testing.md). Manual pass over the app: [docs/walkthrough.md](docs/walkthrough.md).
`bun run check:shaders` compiles every `src/ops/**/*.glsl` in headless Chromium (SwiftShader).
`bun run test:visual` compares one cooked frame to `tests/golden`. Update with `bun run test:visual -- --update <name>` only when the picture change is intentional.
`bun run test:room` opens two tabs in one room and checks they converge. Needs `bun run dev` and `bun run server`.
Do not write unit tests unless human instructs.
