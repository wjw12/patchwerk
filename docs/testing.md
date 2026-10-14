# Testing

Use the cheapest tier that can answer the question. Go up a tier only when the one below cannot see the problem.

| Question | Tier |
|---|---|
| Does this GLSL compile? Does the TS typecheck? | 1 |
| Did the cooked picture change? Do two tabs still converge? | 2 |
| Does it look right, animate, react to input, run fast enough? | 3 |

## Tier 1: compile

```sh
bun ./node_modules/typescript/bin/tsc --noEmit
bun run check:shaders
```

`check:shaders` compiles every `src/ops/**/*.glsl` through the same wrapper the engine uses, in headless Chromium (SwiftShader). Seconds, no dev server.

## Tier 2: golden images and the room

Needs `bun run dev` on port 5173 (and `bun run server` for the room test).

```sh
bun run test:visual            # cook one frame per case in tests/visual.config.ts, compare to tests/golden
bun run test:room              # two tabs in one room: seed, add, type, drag, reload, undo
```

- Goldens are read from the `out` node's float framebuffer, center 256×256, tolerance 2/255. SwiftShader makes them deterministic across machines.
- Update a golden (`bun run test:visual -- --update <name>`) only when the picture change is intended, and say why in the commit.
- Add a case only for a graph whose look must not drift. A fixed session (`?graph=…&t=…&frame=…`) is the way to cook a reproducible frame.

## Tier 3: real browser, real GPU

For anything a person has to look at: composition, motion, interaction, audio, performance.

- **By hand:** Windows Chrome/Edge at http://localhost:5173/, following [walkthrough.md](walkthrough.md).
- **Scripted interaction:** a Playwright script using `launchBrowser()` from `scripts/browser.ts`. It drives the UI and reads pixels, but it is SwiftShader: correct pictures, meaningless frame rates.
- **Real-GPU screenshot from WSL:** Edge's debug port is unreachable from WSL, but a one-shot headless screenshot works and uses the real GPU:

  ```sh
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
    --user-data-dir='C:\Users\Public\pw\prof' --window-size=1280,800 --virtual-time-budget=6000 \
    --screenshot='C:\Users\Public\pw\shot.png' "http://localhost:5173/?graph=/tests/graphs/cloud.json&t=2&frame=120"
  ```

  Take two times to confirm something animates. Open the PNG and look at it.

### Performance

Only measure on the real GPU. Time a whole cook by running a few cooks back to back and forcing a sync with a 1-pixel `readPixels`; `gl.finish()` does not wait for the GPU in Chrome, and timer queries under vsync include wait time. Results can be posted from the page to a small local HTTP listener, since Windows Edge reaches WSL ports on `localhost`.

## Pitfalls

- One Vite per `node_modules`. Two dev servers sharing `node_modules/.vite` break each other ("Invalid hook call", duplicate Yjs). Restart with `bun run dev --force`.
- Do not write unit tests unless asked.
