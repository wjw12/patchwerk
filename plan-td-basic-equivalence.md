# TD basic equivalence plan

POC: a hand-built Patchwerk graph that uses the same *kinds of features* as `electron_cloud2.toe` (and the shared core of the electron-matter patches). Not a 1:1 clone, not a `.toe` reader, not the 693-op catalog.

Reference install: TouchDesigner 2025.32460. Reference art: `C:\Users\shaoy\Desktop\electronTD\electron_matter TD\`. Expanded records: `/tmp/electron_cloud2.toe.dir`.

Stay WebGL2. Do not add WebGPU. Do not keep a second compositor.

---

## 0. Decisions

| Decision | Choice | Why |
|---|---|---|
| GPU API | **WebGL2 only** (`EXT_color_buffer_float`, RGBA16F). No WebGPU, no dual backend | Point-sprite MAT + float-tex POPs + bloom cover the POC. Compute/`imageAtomicAdd` is PCR Pixel-mode only; we are not cloning that. Dual API is a copy every POP→TOP |
| Proof | **~80% of features used in the artwork**, not visual replica, not op-count vs the catalog | If a stranger can build a POP→CHOP-expr→MAT→render→bloom network and it cooks, the engine is TD-class. Matching Josef Pelz PCR or orbital’s 322 nodes is not the proof |
| Import | **No `.toe` / `toeexpand` loader** | Author the POC graph in Patchwerk JSON. Keep TD records as a spec, not a runtime format |
| Default graph | **POP-first demo**, replace `warp → melt(@feedback) → out` | Feedback TOP is absent from cloud2 / orbital / Two_electrons. Time is `absTime.seconds` on parameters |
| Families | `POP \| CHOP \| TOP \| MAT \| COMP` | Same-family wires. Cross-family only via parameter expressions. DAT later (shader source lives on the MAT for now) |
| POP storage | **RGBA32F textures** (or R32F atlases), one texel = one point. Cook with fullscreen/point-draw passes | WebGL2 has no SSBO/compute. Transform feedback is optional later if we need more attrs than 4 textures |
| CHOP | **CPU `Float32Array`**, timeslice = one sample per frame | cloud2 CHOPs are tiny (lfo/pattern/math/null) |
| Expressions | **Subset**: `absTime.seconds`, `op('name')['chan1']`, `+ - * /`, numbers, par refs | Covers every live expression in cloud2’s core chain. Full Python / `parent().par` / matrices wait |
| Par modes | **CONSTANT \| EXPRESSION** only | Files use those two. Export/bind (`67108xxx` on custom COMP pars) wait |
| Draw | **Built-in point MAT** (additive, size from camera Z / focus). Optional GLSL vert+frag later | Splats path in PCR, not Pixel compute. Bloom after render |
| Existing ShaderToy TOPs | **Keep as TOP:shader**. Not the geometry path | melt/warp/audio stay valid post / sandbox nodes |
| Networking | **Out of this plan** | `docs/networking-plan.md` still describes a shader/photo/blend graph. Do not implement that schema until this cook exists; it would freeze the wrong node kinds |
| Tests | Visual goldens for the POC graph + `check:shaders` for new GLSL. No unit tests unless asked | Matches `AGENTS.md` |
| UI | **TD-familiar, not TD-identical.** High-value chrome only (§7) | People who know TD should find the network, viewer, pars, and Tab-add without a tutorial. Do not clone panes, perform mode, or the animation editor |

**Do not:** introduce WebGPU, run WebGL2+WebGPU side by side, parse `.toe`, implement PCR Pixel `imageAtomicAdd`, implement Feedback TOP as the time model, implement SOP, implement DAT-as-first-class, implement 102 POPs, put binary/attrs in JS every frame, evaluate expressions in GLSL (CPU once per cook), use Yjs node types from the networking plan, clone TD’s pane docking / perform mode / OP help / keyframe editor.

---

## 1. What “80% of the artwork” means

Feature list is taken from `electron_cloud2.toe` plus the 43-type intersection with orbital / Lattice / Two_electrons. Count features, not nodes.

### In (must cook)

| # | Feature in the art | Patchwerk equivalent |
|---|---|---|
| 1 | Typed families, same-family wires, params cross family | Graph rule in `store.ts` |
| 2 | Time on parameters, not a feedback loop | `absTime.seconds` in expressions |
| 3 | CHOP lfo (timeslice, frequency) | `chop.lfo` |
| 4 | CHOP pattern (phase from time) | `chop.pattern` |
| 5 | CHOP math remap / add | `chop.math` |
| 6 | CHOP null as `op()` target | `chop.null` |
| 7 | `op('e_noise_amp')['chan1']` style lookup | expression builtin |
| 8 | POP pointgen (circle, N, scale) | `pop.pointgen` |
| 9 | POP noise, 4D (`t4d`), amp/gain, period/seed/harmon | `pop.noise` |
| 10 | POP mathmix (`aaddbmultc`, attr scopes `P`/`Noise`, named result) | `pop.mathmix` |
| 11 | POP mathcombine (`mix` + expr weight) | `pop.mathcombine` or a second mathmix page |
| 12 | POP merge + transform | `pop.merge`, `pop.transform` |
| 13 | COMP cam (`tz`) | `comp.cam` |
| 14 | COMP geo / “this POP is drawn” | `comp.geo` binds POP + MAT + cam |
| 15 | MAT point splat, additive, size from distance/focus | `mat.point` |
| 16 | TOP render at a chosen resolution (960×540 cook is fine; viewer can be 1920×1080 later) | `top.render` |
| 17 | TOP bloom (threshold, fill, intensity, pregamma) | `top.bloom` |
| 18 | TOP out | existing `out` |
| 19 | Par CONSTANT \| EXPRESSION, last-good cook | extend current shader compile gate to all ops |
| 20 | GPU points stay on GPU (no `readPixels` of P in the RAF) | POP tex never downloaded for cooking |
| 21 | Family-colored nodes + family-colored wires | §7.2 |
| 22 | Viewer follows the selected node (image / CHOP graph / POP orbit) | §7.3 |
| 23 | Parameter row: slider **or** expression, per par | §7.4 |
| 24 | Tab palette to add an op by family + name | §7.5 |
| 25 | Playbar: play / pause / reset `absTime` | §7.6 |

That is the 80%. If 1–25 work in one graph, the POC is done.

### Out (the other 20% — do not build)

- PCR Pixel compute (`glsl3`/`glsl4`, `GL_EXT_shader_atomic_float`, `mTDComputeOutputs`)
- Full `PCR_POP_update.tox` (Josef Pelz 1.1.1): Mode switch, bokeh plane, `worldTransform.getInverse()`, `parent.PCR.par.*`
- Light COMP gizmo (circle/tube/primitive/merge pile)
- SOP `filein` default cam mesh
- DAT text/table/info as operators (MAT holds GLSL strings)
- Feedback TOP, TOP level, moviefileout, window, replicator, timeline/keyframe
- `pop.glsl`, `lookuptexture`, `texturemap` (Two_electrons-only)
- Export/bind Par modes, `me.time`, matrix expressions
- Exact node counts, exact 17-point circle, exact bloom numbers, exact palette

### “Fairly complex” bar

A graph with **≥12 nodes across ≥4 families**, expressions on ≥3 parameters, a POP chain of ≥3 cooks, and a render→bloom tail. cloud2’s *core* (ignoring light gizmos / PCR internals) is about that size.

---

## 2. Target POC graph (author in Patchwerk, not imported)

Replace `src/demo.ts`. Names can differ; the *wires and expr* must exist.

```
CHOP lfo        freq=0.02
  → CHOP math   remap -1..1 → 0.1..1
  → CHOP null   e_amp

CHOP pattern    phase = absTime.seconds * 0.1
  → CHOP math
  → CHOP null   e_gain

CHOP lfo        freq=0.05
  → CHOP math   remap -1..1 → 2..7
  → CHOP null   e_focus          # drives point size / focus, not PCR.Focusdistance

POP pointgen    shape=circle  n=256  scale=0.2     # 256 not 17; enough to read as a cloud
  → POP noise   t4d = absTime.seconds * 0.08
                amp  = op('e_amp')['chan1']
                gain = op('e_gain')['chan1']
  → POP mathmix P + Noise * 1 → P
  → POP transform  ry = absTime.seconds * 5

COMP cam        tz=5
COMP geo        pop=transform  mat=point  cam=cam
MAT point       additive  scale from z  focus=op('e_focus')['chan1']

TOP render      geo  960×540
  → TOP bloom   threshold/fill/intensity/pregamma (Leva, cloud2-ish defaults)
  → TOP out
```

Keep the old warp/melt/audio graph loadable via `?graph=` so ShaderToy TOPs do not regress. Do not make it the boot default.

---

## 3. Cook model

One RAF:

1. `absTime.seconds = time` (existing engine clock; expose it to the expr evaluator).
2. Eval every EXPRESSION par on the CPU. `op('x')['chan1']` reads the **previous cook’s** CHOP output (or this frame if the CHOP already ran — see order).
3. Kahn topo on **all** edges. Cycles still illegal. No `@feedback` required for the POC (leave the existing TOP feedback path working).
4. Cook families:
   - **CHOP** — JS, write `channels: Float32Array[]` (length 1 for timeslice).
   - **POP** — bind input attr textures, draw a `n`-vertex or `ceil(n/w)×h` fullscreen pass, write output attr textures.
   - **MAT** — compile-only / state; no cook output.
   - **COMP** — cam writes a view/proj uniform block (JS matrices). geo is a handle: `{pop, mat, cam}`.
   - **TOP** — existing FBO path. `render` draws the geo’s POP with the MAT into an FBO. `bloom` is two+ fullscreen passes. `shader` unchanged.
5. Dirty: recook a node if any input cooked, any par changed, or it reads `absTime` (treat as always dirty). Full recook is acceptable until something is slow.
6. Previews: CHOP = sparkline on a 2D canvas. POP = cheap point preview (same MAT, small FBO) or skip until render exists. TOP = current blit.

Do not download POP textures for cooking. `readPixels` only for visual tests / capture, from `out`, as today.

---

## 4. WebGL2 POP layout

Points are not JS arrays.

```
attr P      : RGBA32F texture, texel i = (x,y,z,1)     width = 256, height = ceil(n/256)
attr Noise  : RGBA32F, (nx,ny,nz,0)
attr Color  : RGBA32F, optional, default white
```

A POP op is a GLSL ES 3.00 **fullscreen** fragment that does:

```glsl
ivec2 id = ivec2(gl_FragCoord.xy);
int i = id.y * 256 + id.x;
if (i >= uN) discard;
vec4 P = texelFetch(sP, id, 0);
// write fragColor to the target attr
```

`pointgen` writes `P` (and optionally `Color`) with no input.
`noise` reads `P`, writes `Noise` (and optionally combines onto `P` if `combineop` is ever needed; cloud2 uses `combineop=none` + mathmix).
`mathmix` reads named attrs / constant scopes, writes `result`.
`merge` = blit A then append B (offset `uN0` in Y or a second pass). For the POC, merge can wait if the demo is a single chain; implement it anyway — every sampled toe uses it.

Draw: `gl.drawArrays(gl.POINTS, 0, n)` with a vertex shader that `texelFetch`es `P` by `gl_VertexID`. That is the MAT, not a POP.

Caps: `MAX_VERTEX_TEXTURE_IMAGE_UNITS` is enough on the 4060 / desktop Chrome. Fail closed if missing, same as `EXT_color_buffer_float`.

---

## 5. Operators to implement

Minimum set. Each op is `{ family, type, pars, cook }`. No TypeScript-per-op class hierarchy required; a table + cook function is enough.

### CHOP

| type | pars | cook |
|---|---|---|
| `lfo` | `frequency`, `amp`=1, `offset`=0, wave=sine | `sin(2π * frequency * absTime.seconds)` → chan1 |
| `pattern` | `phase` (expr), `amp` | `sin(2π * phase)` or ramp — pick sine, document it |
| `math` | `from1,from2,to1,to2`, `chopop` = remap \| add | remap is enough for cloud2; add if two inputs |
| `null` | — | copy input |

### POP

| type | pars | cook |
|---|---|---|
| `pointgen` | `shape` ∈ {circle, sphere}, `n`, `s` (xyz scale) | write P |
| `noise` | `seed, period, harmon, spread, gain, amp, t4d` | simplex/value noise in 4D (P.xyz, t4d). 1–3 harmonics max. Write Noise |
| `mathmix` | one combo: `oper`, `scopeA/B/C`, `result` | opers: `aaddbmultc` (A+B*C), `asubb`, `mix`. Scope = attr name or float |
| `mathcombine` | same as mathmix `mix` | can be an alias of mathmix if you do not want two types |
| `transform` | `t, r, s` (expr-able) | rotate/translate P |
| `merge` | two POP inputs | concat P (and matching attrs) |
| `null` | — | copy |

Skip for POC: primitive, circle, tube, attribute, copy, connectivity, filein, delete, glsl, lookuptexture. Those inflate orbital/Lattice; they are not required to prove the cook.

### MAT

| type | pars |
|---|---|
| `point` | `scale`, `focus` (expr), `alpha`, `additive` (on) |

Vertex: fetch P, `uViewProj * vec4(P.xyz,1)`, `gl_PointSize = scale * (1 + focus / max(z, ε))`.  
Fragment: soft circle, `fragColor = color * alpha * falloff`. Blend: `ONE, ONE`, depth write off.

A later `mat.glsl` (vert/frag text, ShaderToy-like editor) is how you get custom looks without cloning PCR. Not required to close the POC.

### COMP

| type | pars |
|---|---|
| `cam` | `t`, `lookat` or `tz` only | view/proj, fov 45, near/far like the toe viewer |
| `geo` | refs: `pop`, `mat`, `cam` | no pixels; render TOP reads this |

No window, light, replicator, container-as-network.

### TOP (new + keep)

| type | status |
|---|---|
| `shader` / `audio` / `out` | keep |
| `render` | **new** — bind geo, draw POINTS into FBO |
| `bloom` | **new** — bright pass + dual kawase or 2-tap downsample/upsample. Pars: `threshold, fill, intensity, pregamma` |

No feedback node. Existing `@feedback` on shader TOPs stays.

---

## 6. Expression language

One file, `src/engine/expr.ts`. Parse + eval. Do not `eval()`.

Grammar (enough for the artwork):

```
expr     := term {('+'|'-') term}
term     := factor {('*'|'/') factor}
factor   := number | 'absTime.seconds' | lookup | '(' expr ')'
lookup   := 'op(' string ')[' string ']'     # op('e_amp')['chan1']
```

- `op(name)` is sibling-by-label (node `data.label` or `id`). No paths, no `parent()`, no `me`.
- `['chan1']` is CHOP channel 0. Later: `['x']` as alias if we name channels.
- Missing op / missing channel / non-CHOP → cook error on that par, last good value kept (same as shader compile).
- Eval after CHOP cooks in topo order so `noise.amp` sees this frame’s `e_amp`. If a POP expr reads a CHOP that is not an ancestor, use last frame (document it).

Par record:

```ts
type Par = { name: string; mode: "constant" | "expression"; value: number; expr?: string };
```

Par rows are §7.4. Seed the POC graph with the cloud2 expressions already filled in.

---

## 7. UI (TD-familiar, high-value only)

Today (`src/App.tsx`): header + React Flow + right rail (viewer / Leva) + GLSL drawer. Every node is type `"top"`, one purple wire color, viewer is always the `out` TOP, add is a “shader” button, time is a `#stats` fps string. That is a ShaderToy IDE. The POC needs the five TD surfaces people actually use when they build `electron_cloud2`.

Keep the existing 3-region layout. Do not add docking, split viewers, or perform mode.

```
topbar:   name | playbar | hud | save/load/reset
stage:    network (flex)  |  viewer (selected node)
                          |  parameters (selected node)
drawer:   GLSL (TOP:shader / later MAT only)
```

### 7.1 In vs out

| Ship | Why it is high-value | Skip |
|---|---|---|
| Family colors on node header **and** wires | TD literacy is color. cloud2 is unreadable if everything is purple | Pixel-perfect TD palette / 3D node bodies |
| Viewer = **selected** node, family-specific | You debug noise by looking at it, not by guessing | Multi-pane viewers, always-on preview for every node |
| Node thumbnail: TOP image, CHOP sparkline, POP dots | TD’s viewer flag, cheap version | Interactive 3D inside every POP node |
| Par row: value + **expr toggle** | Every live par in cloud2 is an expression. Leva sliders cannot type `op('e_amp')['chan1']` | TD par pages, pulse/export/bind, unit menus |
| **Tab** OP Create (search `noise`, filter family) | Muscle memory #1 after wiring | Full OP Create grid, RMB menu clone, OP snippets |
| Play / pause / reset time | Time *is* the animation. Pause must freeze `absTime.seconds` | Timeline keyframes, animation COMP, beat markers |
| Rename node (click label) | `op('e_amp')` is by **label** | Path bar, nested COMP dive |
| Bypass flag on the node | cloud2 leaves `noise1` bypassed; you need this to debug | Display vs render vs template vs lock flags |
| Viewer button on the node (or: selection *is* the viewer) | Selection → big viewer is enough | Middle-click “always viewer” + pinned extras |
| Inlet/outlet handles, left/right, labeled | Wiring POP→POP and CHOP→CHOP | Connector types beyond family, multi-in mathmix UI later |
| Drag CHOP **output onto a par** → fill `op('that')['chan1']` | How TD artists actually hook amp/gain. Do in phase E if Tab+typing works first | Drag onto *any* field, bind/export |

**Skip entirely:** perform mode, pane docking, OP help wiki, find-in-network, backdrops/annotate, movie export UI, light/cam manipulators in the viewer, parameter-page tabs matching TD, MiniMap family colors (keep the current MiniMap).

### 7.2 Node chrome

One React Flow node component, `data.family` picks the paint. Official-ish hues, not a skin clone:

| Family | Header | Wire |
|---|---|---|
| CHOP | `#1f6b45` | `#3dcf8a` |
| TOP | `#7a2d6b` | `#e07ad4` |
| POP | `#8a4b12` | `#f0a040` |
| MAT | `#3d2a7a` | `#9b86ff` |
| COMP | `#5a5348` | `#c4b8a4` |

- Left inlets = input count for that type (CHOP: 0–2, POP: 0–2, TOP shader: `ch0…`, render: none, bloom: 1). Right = one `out` except MAT/COMP cam (no data out; geo is a ref, not a wire).
- Header: `label` (editable) · `type` (`noise`, `lfo`) · bypass · live/error pip.
- Body: 160×90 canvas. TOP = current blit. CHOP = 1-channel sparkline of the last ~120 samples (ring buffer, CPU). POP = same point shader into a tiny FBO, **no orbit** on the node (orbit is the big viewer). MAT/COMP = no canvas, type name is enough.
- Bypass: skip cook, pass input 0 through (CHOP/POP/TOP). Matches `flags = bypass on` on leftover `noise1`.

`isValidConnection` already rejects cross-family wires. Paint the in-progress connection with the **source** family color.

### 7.3 Big viewer

`Viewer.tsx` today always presents `out`. Change: present the **selected** node.

| Selected | Viewer |
|---|---|
| TOP | existing 2D blit of that node’s FBO |
| CHOP | larger oscilloscope, chan1, last ~2 s, −1..1 (or data range) |
| POP | orbit-able point preview (drag to tumble, wheel dolly). Same `mat.point`, a default cam if no `comp.cam` is selected |
| MAT | draw the upstream geo POP if a `comp.geo` references it; else a unit circle of points |
| COMP cam | the `top.render` that uses this cam, or a gizmo-less POP preview through that view matrix |
| none | last selected, or `out` |

One canvas. Do not pin two viewers. Mic button stays only when an `audio` TOP is selected.

### 7.4 Parameter pane — kill Leva for engine pars

Leva stays acceptable for *shader uniform* `@range` / `@color` (current `Params.tsx`). Every **declared op par** uses a Patchwerk row:

```
[ name ] [ slider | number ] [ ƒ ] [ expression text ……………… ]
```

- `ƒ` off → CONSTANT, slider writes `value`.
- `ƒ` on → EXPRESSION, text writes `expr`, slider disabled (show last eval as read-only).
- Red text + last-good value on parse/lookup error (same as shader compile).
- Rename is not a par; it is the node label in the pane header (`noise3` / `e_amp`).

This is the one UI piece that *unlocks* the artwork. Without it, people cannot enter `absTime.seconds*0.08`.

Optional phase E: drop a CHOP node onto a numeric par → set expression `op('label')['chan1']` and turn `ƒ` on.

### 7.5 Tab — OP Create

`Tab` (or `` ` ``) opens a floating palette over the network, at the cursor (or view center). Type filters. Enter places the node.

```
filter:  [all] chop  pop  top  mat  comp
list:    lfo  math  null  pattern
         pointgen  noise  mathmix  transform  merge
         render  bloom  shader  out
         point
         cam  geo
```

Only ops that exist in the engine. Do not show the 693-name catalog. Escape closes. After place, the node is selected so pars appear.

Replace the header “shader” button with “add” that opens the same palette (mouse users). Double-click empty network canvas → palette.

### 7.6 Playbar

Put it in the topbar, left of hud:

```
[ ▶ / ❚❚ ]  [ ↺ ]  absTime  12.40 s   60 fps
```

- Pause: RAF still presents, `time` does not advance, CHOPs/POP `t4d` freeze.
- Reset: `time = 0`, `frame = 0`, clear CHOP sparkline history, POP feedback-less so just re-cook.
- `#stats` merges into this. Fixed `?t=&frame=` sessions ignore the buttons.

No scrubber, no loop region, no keyframes.

### 7.7 Shader drawer

Keep for `TOP:shader` (and later `mat.glsl`). Hide it for lfo/noise/bloom. Double-click a shader node still opens it; double-click anything else selects + focuses pars, does **not** open a blank GLSL editor.

### 7.8 Files

```
src/ui/Flow.tsx        family nodeTypes, Tab handler, wire color
src/ui/OpNode.tsx      rename TopNode; family chrome + bypass + preview
src/ui/Palette.tsx     Tab OP Create
src/ui/Params.tsx      ParRow for engine pars; Leva only for shader uniforms
src/ui/ParRow.tsx      slider + ƒ + expr
src/ui/Viewer.tsx      selected-node, family presenters
src/ui/Playbar.tsx     play/pause/reset + absTime
src/ui/Header.tsx      mount Playbar; add → palette
src/styles.css         family tokens
```

---

## 8. Types / files

Replace the TOP-only unions. Suggested shape (names can move, ownership should not):

```
src/store.ts          Family, NodeData per kind, wires, save/load v3
src/demo.ts           POC graph above
src/engine/expr.ts    parser + eval
src/engine/cook.ts    topo, dirty, family dispatch  (today this is inside engine.ts)
src/engine/engine.ts  GL context, RAF, present — keep
src/engine/pop.ts     attr textures, pointgen/noise/mathmix/transform/merge
src/engine/chop.ts    lfo/pattern/math/null
src/engine/mat.ts     point program
src/engine/render.ts  render TOP + bloom
src/ops/pop/*.glsl    noise, mathmix, transform, pointgen
src/ops/top/bloom.glsl
src/ui/                see §7.8
```

Bump localStorage key to `patchwerk.graph.v3`. v2 ShaderToy graphs still load via `?graph=` / `graph-file.ts`.

`Family` today is `"TOP" | "CHOP"` and every node is React Flow type `"top"`. Split RF types per family (`top` / `chop` / `pop` / …) or keep one node chrome with a family color. Either is fine; do not keep CHOP as a dead header color.

---

## 9. Implementation order

Do not start with bloom, a shader editor for MATs, or networking.

| Phase | Deliverable | Done when |
|---|---|---|
| A | Families + expr + CHOP + **ParRow + playbar + CHOP viewer/sparkline** | `e_amp` moves with time, `ƒ` accepts `op()`, pause freezes it |
| B | POP + point MAT + cam + render + **family colors / POP viewer / Tab palette** | spinning points; Tab places `pointgen`; selected POP orbits in the viewer |
| C | noise + mathmix + expr on `t4d`/`amp`/`gain` | cloud displaces; amp from CHOP |
| D | bloom + new `demo.ts` + bypass + rename | boot graph is the POC; warp/melt still via URL |
| E | merge + mathcombine; geo COMP; **drag CHOP onto a par** | graph matches §2; dropping `e_amp` on `amp` writes the expr |
| F | visual golden of the POC at `t=2, frame=120` | `bun run test:visual` has `cloud` |

Phase A+B is already “a TD-class graph.” C+D is the 80% proof. E is polish. F locks it. UI that blocks authoring (ParRow, Tab, playbar, family color) is in A/B, not a leftover.

---

## 10. Acceptance

The POC is accepted when **all** of these are true:

1. Booting `bun run dev` and opening in **Windows** Chrome/Edge shows the POP demo, not melt-feedback.
2. At least four families are in the graph and cooking. Nodes and wires are family-colored.
3. Mutating `e_amp` (slider or the lfo) changes the cloud this frame via `op('e_amp')['chan1']`.
4. A parameter’s `ƒ` field accepts `absTime.seconds*0.08`. Pause on the playbar freezes motion; reset returns `t=0`.
5. Selecting a CHOP shows an oscilloscope; selecting a POP shows points; selecting a TOP shows the image. Viewer is the selection, not always `out`.
6. Tab (or Add) opens a palette of **implemented** ops only; placing `noise` selects it and shows its pars.
7. Render → bloom → out is a TOP chain. No feedback node in the demo.
8. `readPixels` is not on the POP cook path.
9. `?graph=/tests/graphs/melt.json` still cooks (ShaderToy path alive). Double-click shader still opens the GLSL drawer; double-click lfo does not.
10. `bun run check:shaders` includes the new POP/MAT/bloom GLSL.
11. One visual golden for the POC graph.

Non-goals that must not sneak in: `.toe` load, WebGPU, PCR Pixel, Yjs schema, unit-test suite, pane docking, perform mode, keyframe timeline.

---

## 11. Mapping cheat sheet (art → engine)

| cloud2 record | POC |
|---|---|
| `POP:pointgen` `shape=circle` `numpoints=17` | `pop.pointgen` n=256 |
| `POP:noise` `t4d=absTime.seconds*0.08` `amp0=op('e_noise_amp')['chan1']` | same expr, our noise |
| `POP:mathmix` `aaddbmultc` P/Noise/1 → Pnoise | one mix writing P |
| `POP:mathcombine` `mix` P/Pnoise/`op(...)` | second mix or `mathcombine` |
| `CHOP:lfo` + `math` remap + `null` | same three |
| `CHOP:pattern` `phase=absTime.seconds*0.1` | same |
| `COMP:geo` PCR_POP + compute splat | `comp.geo` + `mat.point` |
| `Ry = absTime.seconds*5` | `pop.transform` ry expr |
| `TOP:render` 1920×1080 | `top.render` (960×540 cook OK) |
| `TOP:bloom` 0.01 / 0.72 / 1.24 / 1.5 | `top.bloom` same pars, our kernel |
| `cam1.tz=5` | `comp.cam` tz=5 |
| `parlanguage 0` + modes 0 / 48 / 49 | constant \| expression |
| PCR Pixel `imageAtomicAdd` | **out** |
| `TOP:feedback` | **out** (keep only as existing shader `@feedback`) |

---

## 12. After the POC

Only then: more POP generators (sphere/grid), `mat.glsl`, DAT text for shader bodies, CHOP trail/beat, TOP glsl as a non-ShaderToy program, optional `.toe` *import of the subset* (not a goal of this doc), networking on the **new** node kinds, drag-CHOP-to-par if it slipped past E, a second viewer pane if people actually miss it.

Update `AGENTS.md` Now/Next when phase D lands so the product authority stops describing a Feedback-TOP toy.
