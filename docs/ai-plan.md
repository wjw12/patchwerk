# AI: an agent that patches

Hackathon scope. The server holds one Anthropic API key and runs a Claude agent; any web client can hand it a goal. The agent sees the graph, looks at rendered frames, writes shaders, edits parameters, adds and wires nodes, and iterates until the goal is met. It acts only on the room it was asked from.

SDK facts are in `claude-agent-sdk.md`. This file is the design. Reviewed 2026-10-14 by an Opus pass against the code; its findings are folded in below. Built 2026-10-14 (steps 1–6 of §5); the code is the reference where it differs in wording from the specs here.

---

## 0. Decisions

| Decision | Choice | Why |
|---|---|---|
| Agent loop | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) in the room server | The loop, context management, and multi-turn sessions come free. Built-in tools are switched off; only ours exist. |
| Where tools execute | **The browser that asked** | The GPU, the compiler, the op catalog and the Yjs mirror all already live there. The server never learns the graph schema. Changes land in the room like any human edit. |
| Server role | Relay + API key holder + owner of the system prompt | One websocket route (`/ai`) per agent session. Each tool call is one RPC to the browser and back. The client sends a goal, never prompt text. |
| Transport | JSON over the existing `Bun.serve` websocket | No new server, no HTTP streaming. |
| Vision | `view` tool returns PNG(s) of any node's output | The engine already knows how to paint every node kind into a 2D canvas; reuse that offscreen at 768×432. |
| Session | One `query()` per websocket, streaming-input mode | Follow-up goals are pushed into the same conversation; stop interrupts the turn, closing the tab aborts. |
| Presence | Agent appears as a peer through awareness | Everyone in the room sees "claude" and which node it is editing. |
| Auth | None (optional `AI_TOKEN` shared secret) | Hackathon. `maxTurns`, `maxBudgetUsd` and one agent per room cap the blast radius. |
| Model | `claude-opus-5-5`, env `AI_MODEL` | Decided. |
| Autonomy | Full inside the room: add, rewire, rewrite, delete | Decided. The prompt asks it to preserve existing work unless the goal needs otherwise; the panel has a stop button. |

**Not doing:** server-side graph mutation (would duplicate `catalog.ts`, `sync.ts` encoding, `isValidConnection`), headless rendering on the server (no GPU), accounts, queues, a fallback agent loop.

**Maybe later:** an "undo claude" button. A `Y.UndoManager` tracking a dedicated `AGENT` transaction origin, set around agent-caused pushes, gives it almost for free.

---

## 1. Shape

```
browser (room /r/foo)                     server                          Anthropic
┌───────────────────────┐   ws /ai   ┌──────────────────────┐
│ Assistant panel       │ ─────────► │ ai.ts: session/socket│ ──query()──► Claude
│   goal, transcript    │ ◄───────── │   Agent SDK          │ ◄─────────── tool_use
│ execute.ts            │  tool_call │   MCP server with    │
│   store + engine      │ ─────────► │   9 tools; each      │
│   snapshot → PNG      │ tool_result│   handler = RPC      │
└──────────┬────────────┘            └──────────────────────┘
           │ zustand → sync.ts → Yjs → everyone in the room
```

The agent's hands and eyes are the requesting tab. That tab is also a normal room member, so every store action the agent causes is pushed to the Y.Doc by the existing `push()` and other peers see it immediately. The tab's own UI (selection, viewer, editor, params panel) is the human's; the agent never changes it.

---

## 2. Protocol (`src/ai/protocol.ts`, type-only, imported by both sides)

Client → server
```
{ type: "start",  room, goal, graph }     // graph: get_graph text, goes into the first user message
{ type: "user",   text, graph }           // follow-up turn, with a fresh graph
{ type: "result", id, content, isError? } // answer to a tool_call; content = MCP content blocks (text / image)
{ type: "stop" }                          // q.interrupt(): ends the current turn, keeps the session
```

Server → client
```
{ type: "tool_call", id, name, input }    // run this in the browser
{ type: "text",      text }               // assistant prose (deltas; includePartialMessages: true)
{ type: "ready",     model }                      // once per socket
{ type: "done",      cost, turns, isError?, message? }   // one turn finished; cost is the session's running total, message the final text or the error subtype
{ type: "error",     message }
```

The SDK runs read-only tools (`get_graph`, `read_shader`, `view`) in parallel, so several `tool_call` frames can be in flight. The browser answers them through a promise queue, one at a time, in arrival order; a `Map<id, resolver>` on the server matches results. Each RPC has a 20 s server-side timeout that becomes an `isError` tool result. Socket close → `abortController.abort()`, close the input stream, reject every pending RPC.

---

## 3. Server (`server/ai.ts`)

- `index.ts` branches websocket upgrades on `url.pathname`: `/ai` → `aiSocket`, everything else → Hocuspocus as today.
- One agent per room: `Map<room, socket>`; a second `start` is answered with `error: "claude is already working in this room"`.
- Per socket: an `AbortController`, the pending-RPC map, and an async generator of `SDKUserMessage` fed by `start`/`user` frames.
- Static system prompt (§9) built once at boot. The catalog block is generated from `OPS` plus the `DESCRIBE` and `PAR_NOTES` maps in `src/ops/catalog.ts`, which the server imports directly (`../src/ops/catalog.ts` has no DOM dependency). No client text ever enters the system prompt.
- `query({ prompt: generator, options })` with:
  ```ts
  {
    model: process.env.AI_MODEL ?? "claude-opus-5-5",
    systemPrompt: SYSTEM,                               // plain string, not the claude_code preset
    tools: [],                                          // no built-ins
    mcpServers: { patchwerk: createSdkMcpServer({ name: "patchwerk", version: "1.0.0", tools, alwaysLoad: true, timeout: 30_000 }) },
    allowedTools: ["mcp__patchwerk__*"],
    permissionMode: "dontAsk",
    settingSources: [],
    cwd: scratchDir,                                    // empty, per process
    env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    persistSession: false,
    includePartialMessages: true,
    maxTurns: 60,
    maxBudgetUsd: Number(process.env.AI_BUDGET_USD ?? 3),
    abortController,
  }
  ```
- Each tool handler: `await rpc(ws, name, input)` → returns the browser's content blocks as the tool result (`isError` passed through).
- Stream SDK messages to the socket: `stream_event` text deltas → `text`; `result` → `done` with `total_cost_usd` (running total for the whole session), `num_turns`, and `is_error` for `error_max_turns` / `error_max_budget_usd`.
- At boot, run one `query` against a dummy socket and log the `init` message's `tools`: it must list exactly the nine `mcp__patchwerk__*` names and nothing else. This is also the Bun smoke test.
- Env: `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_BUDGET_USD`, `AI_TOKEN` (optional, checked on `start`).

---

## 4. Client

- `src/ai/client.ts`: a zustand store `useAssistant` (`status`, `transcript`, `cost`), `start(goal)`, `send(text)`, `stop()`; opens `ws(s)://<sync host>/ai`; dispatches `tool_call` to `execute.ts` through a serial queue. Disabled in fixed `?graph=` sessions and until the room is `synced`.
- `src/ai/execute.ts`: the tool implementations (§8) against `useGraph` and `engine`. Pure functions of the store so they can be driven from the console.
- `src/ui/Assistant.tsx`: a panel under the viewer: goal box, transcript (prose, one line per tool call with thumbnails of what the agent viewed), stop button, running cost.
- Presence: while a turn runs, awareness `editing` is set to the node being mutated and an `agent: true` flag is set so `readPeers` can show a "claude" badge.

### Engine and store additions (before `execute.ts`)

The store and engine were built for a human at the keyboard. Three small APIs make them usable by a tool:

1. `addOp(family, type, { position?, after?, label?, select? }) → id`. Returns the id, takes the `after` node explicitly instead of reading selection, and with `select: false` leaves selection and the editor alone. The palette keeps calling it with `select: true`.
2. `engine.compileNow(id) → { status, error }`. Clears the debounce timer, records the draft, runs `tryCommit` synchronously (compile and test frame are synchronous WebGL), returns the result. No store subscription, no timeout, no hidden-tab throttling.
3. `engine.snapshot(id, w, h) → Promise<{ png: string, stats }>`. Waits for the next cook (rejects with "tab is in the background; frames are not cooking" when `document.hidden`), paints the node the way `presentViewer` would into an offscreen canvas using its own preview slot (not the viewer's), sizes the drawing buffer for `w×h`, and for TOP nodes also does a float `readPixels` on the node's target (as `capture()` does) for the NaN and black statistics. Never touches selection or the viewer.

Also a `validateExpr(expr)` helper that parses with an `ExprEnv` whose `op()` only checks that the label exists and is a CHOP (a CHOP added one call earlier has not cooked yet, so the live env would wrongly reject it).

---

## 5. Build order

1. `docs/claude-agent-sdk.md` and this plan. Done.
2. Store/engine additions (§4) and `src/ops/catalog.ts` `DESCRIBE`. `execute.ts` with `get_graph`, `view`, `set_param`; drive them from the console.
3. `server/ai.ts` with the boot-time init check (Bun smoke test), then those three tools end to end with `Assistant.tsx`. First goal: "make it more blue".
4. `write_shader`, `add_node` (splice), `connect`, `disconnect`, `edit_node`.
5. Multi-frame `view`, presence badge, cost display, follow-up turns, stop.
6. `scripts/smoke-ai.ts`: headless tab + server, one goal, assert the graph changed and `done` arrived.

---

## 6. Risks

- **Subprocess per session.** The SDK spawns the bundled Claude Code CLI over stdio: about 1 GiB RAM and a core per live session. One agent per room plus a global cap (4) and a clear message past that.
- **Bun.** The SDK lists Node 18+ and an `executable: "bun"` option with auto-detect. There is no `node` on the dev machine. The boot-time init check in §3 is the smoke test. Decision: Agent SDK only; if Bun misbehaves, install Node on the server box and pass `executable: "node"`.
- **Deferred tools.** Tool search is on by default and defers SDK MCP tools; `alwaysLoad: true` keeps ours in the prompt. The init check catches it.
- **Images cost tokens every turn.** 768×432 PNG ≈ 440 input tokens, at most 4 per `view`; the prompt says to look only after a change.
- **Concurrent shader edits.** `writeNode` replaces a `Y.Text` wholesale, so the agent and a human typing in the same shader interleave into garbage. `write_shader` refuses when a peer's awareness `editing` is that node.
- **Unverified in the SDK doc:** whether `ToolSearch`/`Agent` stay present with `tools: []`, whether `maxTurns` counts per query or per user turn in streaming mode, Bun stdio/abort behaviour. All resolved by the init check and `smoke-ai`.

---

## 7. Facts about the engine the specs depend on

Checked against the code on 2026-10-14; cited so the specs can be re-verified.

- Cook size is 960×540 float (`render.ts:7`). Viewer fallback is the node with id `out`, selection is per tab, `playing` is per tab (`engine.ts:561`, `sync.ts` never syncs either).
- `updateDraft` keeps every `chN` wire (`keepsWire`): a draft is half-typed text. `write_shader` removes the wires into channels the new code no longer reads itself and reports them.
- Removing a node via `onNodesChange` leaves its edges in zustand (`store.ts:190`); `isValidConnection` then reports the inlet occupied.
- `addOp` only auto-wires when the new node has an inlet; the shader `TEMPLATE` reads no `iChannel`, so a fresh shader TOP has none (`template.glsl`). Nothing splices a node into an existing wire.
- The test frame: 48×48 at `iTime 0.35`, a test pattern on every `iChannel`, uniforms at their annotation default (min when there is none). Rejected on NaN, solid black (max luma < 4/255) or a single solid color (`engine.ts:1252-1310`, `wrap.ts:185`).
- Annotations are one per line and must end the line: `uniform float x; // @range min max [default v] [label "…"]` in that order; `uniform vec3 c; // @color #rrggbb [label "…"]` (`wrap.ts:177,196`). `// @feedback` and `// @prev iChannelN label` are full-line comments; those channels are not inlets (`wrap.ts:158-170`).
- `followRename` updates expressions and ref pars, not `// @prev` lines (`store.ts:381-410`).
- `iCursors[i].xy` is 0..1 over the picture, y up; `iMouse` is in cook pixels (`engine.ts:1516-1534`).
- The audio spectrum is synthetic until a human enables the mic with a click (`engine.ts:441-458, 1465-1473`); `audioband` reads it either way.
- Bypass: TOP passes ch0 (a shader with no ch0 goes black), `render` outputs empty, a generator CHOP outputs 0 (`engine.ts:670, 735, 768`).
- `uniqueLabel` is per client (`store.ts:371`); `noise` becomes `noise1`, then `noise2`. The expression env knows one channel, `chan1` (`engine.ts:837`).
- Merge caps a cloud at 4096 points (`pop.ts:11`).

---

## 8. MCP tool specs

What the model reads. Descriptions are the real tool descriptions; schemas are the zod raw shapes passed to `tool()`. Every tool runs in the asking browser against the live room. Every result is text unless noted; errors come back as `isError: true` with a sentence that says what to do instead, never a stack trace.

Conventions shared by all tools:

- **`node`** arguments take a label (`bloom`, `cam1`) or an id; a label match wins. Labels are what `op('label')` and name pars use, so prefer labels. Unknown node → error listing the labels that exist.
- **Inlets** are named: shader TOPs `ch0`..`ch3` for each `iChannelN` the code reads (channels taken by `@feedback`/`@prev` are not inlets), `out` has `ch0`, ops have `in0`..`in{N-1}` where N is the catalog's `inputs`. **Outlet** is always `out`; MAT and COMP nodes have none.
- **Families never mix on a wire.** A TOP cannot feed a POP. Cross-family links are parameters: `geo.pop / geo.mat / geo.cam` and `render.geo` hold a label; number pars hold expressions that read CHOPs.
- The result of a mutating tool always ends with the one-line graph delta it caused (`+ node noise1 POP/noise`, `~ cam1.fov 45 → 78`, `+ wire bloom.out → grade.ch0`, `- wire streak.out → grade.ch0`), so the transcript doubles as a log.
- Tools marked read-only (`get_graph`, `read_shader`, `view`) may be called in parallel; the browser still runs them one at a time.

### `get_graph` (read-only)

> The whole patch as text: every node with family, type, status, error and parameters (expressions with their current value), every wire, who else is in the room and what they are editing, and the mic state. Call this first, and again after a sequence of edits to confirm the state.

Input: `{}`

Output (text):
```
time 12.4s  playing (this tab)  cook 960x540  mic off (synthetic spectrum until a human enables it)
people: ana editing grade, bo
nodes (14)
  drift      CHOP/lfo        live   frequency=0.09 amp=0.45 offset=0
  e_drift    CHOP/null       live
  tube_noise POP/noise       live   seed=0 period=0.45 harmon=2 spread=2 gain=0.5 amp=0.4 t4d=expr(absTime.seconds * 0.1)=1.24
  flycam     COMP/cam        live   tx=expr(op('e_drift')['chan1'])=0.31 ty=expr(cos(absTime.seconds * 0.5) * 0.3)=0.29 … fov=78
  geo1       COMP/geo        live   pop=tube mat=mat1 cam=flycam
  render     TOP/render      live   geo=geo1
  streak     TOP/shader      live   inlets[ch0]  uDecay=0.84 [0..1] uZoom=0.012 [0..0.1] uKick=0 [0..4] iChannel0.filter=linear iChannel0.wrap=clamp
  grade      TOP/shader      ERROR  inlets[ch0]  line 12: 'vec2' : syntax error   (last good program still shows)
  lfo2       CHOP/lfo        ERROR  frequency=expr(op('gone')['chan1'])  op('gone') is missing
  out        TOP/out         live   inlets[ch0]
wires (8)
  drift.out → e_drift.in0
  bloom.out → streak.ch0
  streak.out → grade.ch0
  grade.out → out.ch0
```
Number pars print `name=value [min..max]` for shader uniforms and `name=value` for ops (ranges are in the catalog). Expression pars print `expr(...)=current`. Colors print `#rrggbb`. Bypassed nodes get a `BYPASS` flag. Shader bodies are not included; use `read_shader`.

### `read_shader` (read-only)

> The GLSL source of a shader TOP with line numbers, its compile status and error, and the parameters parsed from its annotations.

Input: `{ node: string }`

Output (text): status line, then the source with 1-based line numbers so compiler errors are easy to place, then `params:` with the `@range`/`@color` uniforms and the `iChannelN.filter/.wrap` menus.

### `write_shader`

> Replace the whole GLSL body of a shader TOP and compile it. Returns `live` or the compiler errors with line numbers of your source. Write the complete file, not a patch: ShaderToy mainImage style, no #version, no main(). A program must pass a test frame (no NaN, not solid black, not a single flat color); a failing program is kept as the draft while the last good program keeps rendering. Inputs follow the code: an iChannelN the new code does not read loses its wire immediately, even if the compile fails, and the result lists any wire that was dropped.

Input: `{ node: string, code: string }`

Output (text): `live — compiled and passed the test frame` or
```
error — 2 problems
  line 12: 'vec2' : syntax error
  line 30: 'uv' : undeclared identifier
draft saved; previous program still showing
- wire streak.out → grade.ch0 (code no longer reads iChannel0)
```
Browser side: snapshot `edges`, `updateDraft`, `engine.compileNow(id)`, diff `edges`, report. Refused with `ana is editing grade right now; ask them or pick another node` when a peer's awareness `editing` is this node.

### `set_param`

> Set one parameter on one node. A number sets a constant; `{expr}` makes the parameter cook from an expression every frame; a string picks a menu option or sets a name parameter (geo.pop, geo.mat, geo.cam, render.geo); `#rrggbb` sets a color uniform. Values outside the slider range are accepted and flagged. Integer parameters are rounded.

Input:
```ts
{
  node: string,
  name: string,                       // par name as printed by get_graph, e.g. "fov", "uDecay", "iChannel0.wrap"
  value: number | string | { expr: string }
}
```

Output (text): `~ flycam.fov 45 → 78`, `~ noise1.t4d → expr(absTime.seconds * 0.1)`, `~ grade.uMid #2a8cff → #ff8800`, `~ mat1.scale 6 → 90 (outside slider range [0.1..64])`, or an error: `no par "freq" on drift; it has frequency, amp, offset`, `menu shape accepts circle, sphere`, `geo1.cam must name a COMP/cam; there is flycam`, `expression error: op('lfo9') is missing; CHOPs are drift, e_drift`.

Browser side: shader uniforms go through `setParam` with a `ShaderParamPatch`; op pars through `setOpPar`; name pars are checked against the par's `ref` family/type before writing; expressions go through `validateExpr` first. Expression mode does not change `value`, so switching back to a constant later restores the old number.

### `add_node`

> Add an operator and return the label actually assigned (labels are made unique, so `noise` may become `noise1`). If `after` is given, the new node is spliced in after it: after.out feeds the new node's first inlet, and whatever after.out used to feed is now fed by the new node, so inserting an effect before `out` is one call. For a shader TOP pass `code` so it has an inlet (the template has none); the code is compiled before wiring and compile errors are returned the same way as write_shader.

Input:
```ts
{
  family: "TOP" | "CHOP" | "POP" | "MAT" | "COMP",
  type: string,                       // from the catalog, plus TOP "shader" | "audio" | "out"
  label?: string,                     // wanted label; uniquified
  after?: string,                     // same-family node to splice this one after
  code?: string                       // shader TOP only
}
```

Output (text): `+ node vignette TOP/shader` then the compile line, then `+ wire grade.out → vignette.ch0`, `~ wire vignette.out → out.ch0 (was grade.out)`. Name pars with a `ref` (geo's pop/mat/cam, render's geo) are guessed from the graph and reported (`geo1: pop=tube mat=mat1 cam=flycam (guessed)`) so they can be corrected with `set_param`.

Browser side: `addOp(family, type, { after, select: false })` → id; `rename`; for shaders `updateDraft` + `compileNow`; then for `after`: find the edge from `after.out` to its downstream inlet, remove it, wire `after.out → new.first inlet` and `new.out → old downstream inlet`, each through `isValidConnection`. Position: right of `after`, else a free spot below the lowest node.

### `connect`

> Wire source.out into target.inlet. Both nodes must be in the same family, the inlet must exist and be free, and the wire must not close a loop (use `// @feedback` or `// @prev` in a shader for feedback). Returns the reason when the wire is refused.

Input: `{ source: string, target: string, inlet: string }`   e.g. `{ source: "bloom", target: "grade", inlet: "ch0" }`

Output (text): `+ wire bloom.out → grade.ch0` or `refused: grade.ch0 is already fed by streak; disconnect it first`, `refused: families differ (POP → TOP); a POP reaches a TOP through geo → render`, `refused: would form a cycle`, `refused: grade has no inlet ch2 (its code reads iChannel0 only)`, `refused: mat1 has no outlet; a MAT is used through geo.mat`.

Browser side: the `isValidConnection` checks re-run one at a time to name the reason, then `onConnect`.

### `disconnect`

> Remove the wire feeding target.inlet.

Input: `{ target: string, inlet: string }` → `- wire streak.out → grade.ch0` or `nothing feeds grade.ch0`.

### `edit_node`

> Rename, bypass or delete a node. Renaming follows expressions and geo/render name parameters, but not `// @prev` lines in shader code. Deleting removes the node's wires too. Bypass passes a TOP's ch0 through (a shader with no ch0 goes black), makes render output nothing, and makes a generator CHOP output 0; use it for A/B checks, not as a mute.

Input: `{ node: string, label?: string, bypass?: boolean, delete?: boolean }`

Output (text): `~ noise1 renamed to swirl (2 references followed)`, `~ bloom bypass on`, `- node swirl (2 wires removed)`. Deleting the `out` node or a node a peer is editing is refused.

Browser side: delete = `onEdgesChange` remove for every edge touching the node, then `onNodesChange` remove.

### `view` (read-only)

> Look at a node's output as an image. Default is the final picture (`out`). `frames` > 1 returns that many captures spaced `interval_ms` apart so you can judge motion. CHOP nodes return samples over that span as numbers instead of an image. Each image comes with a stat line (mean brightness, fraction of black pixels, NaN count) so you can catch an all-black or broken frame without guessing.

Input: `{ node?: string, frames?: 1 | 2 | 3 | 4, interval_ms?: number }` (default `out`, 1, 400; interval 100..2000)

Output: for TOP/POP/MAT/COMP nodes, content blocks `[text, image, (text, image)…]`:
```
out @ 12.4s  768x432  mean luma 0.31  black 4%  nan 0
```
followed by `{type:"image", mimeType:"image/png", data}`; one pair per frame. For CHOP nodes, text only: `drift over 1.2s (3 frames x 400ms, sampled every cook): -0.44 -0.41 … 0.12   min -0.45 max 0.45 now 0.12`. When this tab's clock is paused the stat line says `paused in this tab: frames are identical; ask a human to press play`. In a background tab the tool errors with `the asking tab is in the background; frames are not cooking; ask the human to bring it to the front`.

Browser side: `engine.snapshot(id, 768, 432)` per frame with `await sleep(interval)` between; base64 PNG without the `data:` prefix. Nothing in the UI changes.

### Not tools (on purpose)

- No file, shell, web or project operations. The room is the whole world.
- No `save/load/reset`: those are the human's buttons and `reset` would wipe the room.
- No `set_playing`: the clock is per tab, so the agent could only pause the asker's view. `view` reports paused instead.
- No `catalog`: it is in the system prompt.
- No undo. The agent's edits are ordinary room edits; a human can change them back.

---

## 9. System prompt

Sent as `systemPrompt` (a plain string) and identical for every session so the prefix caches. `{{catalog}}` is generated at server boot from `OPS` plus the `DESCRIBE` and `PAR_NOTES` maps in `src/ops/catalog.ts`. The goal and the current graph go in the **user** message: `Goal: <goal>\n\nRoom now:\n<get_graph text>`; follow-up turns attach a fresh graph the same way.

```
You are the patch assistant inside Patchwerk, a multiplayer generative-art engine in the spirit of TouchDesigner. People in this room are watching the picture change live. You are given a goal and you reach it by editing the live patch with the tools, looking at the result, and iterating.

# The world

A patch is a dataflow graph of operators. Operators belong to a family:
- TOP: images on the GPU (960x540 float). A shader TOP is one GLSL ES 3.00 fragment program. `render` draws a geo; `bloom` glows; `out` is the final picture (each person's viewer shows it unless they select another node).
- CHOP: one number per frame on the CPU (lfo, pattern, audioband, math, null). Its value is read by expressions: op('label')['chan1']. chan1 is the only channel.
- POP: point clouds on the GPU, one texel per point, at most 4096 points.
- MAT: how a POP is drawn (point).
- COMP: cam (camera), geo (binds a pop, a mat and a cam).

A wire only connects two operators of the same family. Everything else is a parameter:
- geo.pop, geo.mat, geo.cam and render.geo hold another node's label.
- Any number parameter can be an expression evaluated every frame: absTime.seconds, op('lfo1')['chan1'], + - * / ( ), sin cos abs floor fract sqrt min max pow mod clamp, pi. Nothing else (not Python, not GLSL).
- Labels are unique and are how nodes refer to each other. Renaming follows expressions and name parameters, not `// @prev` lines in shaders.

The recipe for points on screen: POP chain → geo.pop; a point MAT → geo.mat; a cam → geo.cam; render.geo = that geo; render → bloom and shader TOPs → out.ch0.

Cooking walks the wires: a node recooks when an input, a parameter or time changed. Cycles are refused. The two legal loops are inside shaders: `// @feedback` (iChannel3 is this node's previous frame) and `// @prev iChannelN label` (iChannelN is another TOP's last frame; `self` means this node). Each goes on its own line, and that channel is then not an inlet.

# Shader TOPs

ShaderToy style. You write `void mainImage(out vec4 fragColor, in vec2 fragCoord)`; the engine adds the version line, precision, uniforms and main(). Never write `#version` or `main`. Available uniforms: iResolution, iTime, iTimeDelta, iFrame, iFrameRate, iMouse (pixels), iDate, iSampleRate, iChannel0..3 (sampler2D), iChannelResolution[4], iChannelTime[4], iCursors[8] (vec4: x and y in 0..1 over the picture with y up, z = pressed; one per person's pointer, iCursorCount of them).

Inputs: reading iChannelN in the code creates inlet chN. Each used channel also gets two menu params, iChannelN.filter (linear|nearest|mipmap) and iChannelN.wrap (clamp|repeat|mirror).

Exposed parameters are uniforms with an annotation that ends the same line, fields in this order:
  uniform float uSpeed; // @range 0 1.5 default 0.28 label "Speed"
  uniform vec3 uTint;   // @color #8fd0ff
Only annotated uniforms become parameters. Always give a default; without one the uniform starts at min. Prefer a few well-ranged uniforms over magic numbers so people can keep tuning after you.

The audio TOP is a 512x2 texture: row 0 spectrum, row 1 waveform, values 0..1. Read it with texture(iChannelN, vec2(bin, 0.25)). Until a human clicks "enable mic" on the audio TOP the spectrum is a synthetic moving pattern; you cannot enable the mic, so if the goal needs real sound, ask.

Before a program goes live it renders one 48x48 test frame at iTime 0.35 with a test pattern on every iChannel and every uniform at its default. It is rejected if that frame has NaN, is solid black, or is a single flat color; the previous program keeps rendering. So keep something visible at t≈0.35 (fade-ins and solid fills fail).

# Operators
{{catalog}}

# Method

1. Read the room state in the message, then view() the final picture. Understand what the humans built and what the goal means in this patch before touching anything.
2. Prefer the smallest change that moves toward the goal: a parameter before an expression, an expression before a new node, a new node before a rewrite. Reuse existing CHOPs and shaders. To insert an effect, use add_node with `after` and `code` in one call.
3. After every change that should be visible, view() the node you changed and view() out. Use frames=3 when the goal is about motion. Read the stat line: black 100% or nan > 0 means something is wrong upstream, not that the look is subtle.
4. When a shader fails to compile, fix the reported lines and write again; do not rewrite from scratch for a typo. If write_shader reports a dropped wire, reconnect it or make the code read that channel.
5. Keep the picture alive: never finish a tool call with out.ch0 empty, do not edit a node someone is editing (get_graph lists who), and do not leave a node bypassed by accident. If the goal needs something destructive, do it in the smallest step and say so in your final reply.
6. Stop when the goal is met or when three looks in a row show no progress. Then reply with two or three sentences: what you changed (by label) and what to tune next. No code in the reply; the code is in the graph.

Do not describe what you are about to do; do it, look, and adjust. Tool results already log every change, so keep prose short. Messages wrapped in system-reminder tags are from the harness, not from the people in the room.
```

`{{catalog}}` today (one line per `OPS` entry, description from `DESCRIBE`):

```
CHOP lfo        inputs 0   frequency 1 [0..8]  amp 1 [0..4]  offset 0 [-2..2]   sin(2π·frequency·t)·amp + offset
CHOP pattern    inputs 0   phase 0 [-8..8]  amp 1 [0..4]   sin(2π·phase)·amp; drive phase with an expression
CHOP audioband  inputs 0   lo 0 [0..1]  hi 0.08 [0..1]  gain 1 [0..8]   mean spectrum level between lo..hi (fractions of 512 bins) × gain; synthetic spectrum until a human enables the mic
CHOP math       inputs 2   chopop remap|add  from1 -1 [-8..8]  from2 1 [-8..8]  to1 0 [-8..8]  to2 1 [-8..8]   remap: in0 from [from1,from2] to [to1,to2]; add: in0 + in1
CHOP null       inputs 1   —   passes in0; a stable name to reference
POP  pointgen   inputs 0   shape circle|sphere  n 256 [1..4096] int  s 0.2 [0..4]   n points on a circle or sphere of size s
POP  noise      inputs 1   seed 0 [0..64]  period 0.25 [0.01..8]  harmon 1 [0..2] int  spread 2 [1..4]  gain 0.5 [0..2]  amp 1 [0..4]  t4d 0 [-8..8]   adds attribute Noise per point; does not move points; follow with mathmix. t4d animates it
POP  mathmix    inputs 1   oper aaddbmultc|asubb|mix  scopeA P  scopeB Noise  scopeC 1  result P   result = A + B·C | A − B | mix(A, B, clamp(C, 0, 1)); a scope is an attribute (P, Noise, an earlier result) or a number
POP  mathcombine inputs 1  oper mix|aaddbmultc|asubb  scopeA P  scopeB Pnoise  scopeC weight  result P  weight 1 [0..1]   as mathmix; scopeB must exist upstream, scopeC may name this node's weight par
POP  transform  inputs 1   tx 0 ty 0 tz 0 [-8..8]  rx 0 ry 0 rz 0 [-360..360]  sx 1 sy 1 sz 1 [0..4]
POP  merge      inputs 2   —   concatenates in0 and in1, at most 4096 points total
POP  null       inputs 1   —   passes in0
MAT  point      inputs 0   scale 6 [0.1..64]  focus 4 [0..32]  alpha 0.85 [0..1]  colorr 1 colorg 1 colorb 1 [0..4]   additive points; color above 1 blooms
COMP cam        inputs 0   tx 0 [-20..20]  ty 0 [-20..20]  tz 5 [-40..40]  fov 45 [10..120]  lookx 0 [-20..20]  looky 0 [-20..20]  lookz 0 [-40..40]   camera at t looking at look
COMP geo        inputs 0   pop <POP label>  mat <MAT label>  cam <cam label>   what render draws
TOP  render     inputs 0   geo <geo label>   draws the geo's points into an image
TOP  bloom      inputs 1   threshold 0.01 [0..1]  fill 0.72 [0..1]  intensity 1.24 [0..4]  pregamma 1.5 [0.2..4]   glow
TOP  shader     inlets chN for each iChannelN the code reads   params from @range/@color   one GLSL program
TOP  audio      inputs 0   the microphone (or a synthetic pattern) as a 512x2 texture
TOP  out        inlet ch0   the final picture
```
