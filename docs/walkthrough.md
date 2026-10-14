# Walkthrough

A ten-minute manual pass over the app. Use Windows Chrome or Edge at http://localhost:5173/ (a WSL browser is the wrong GPU). Start `bun run dev` and `bun run server` first.

`/` redirects to a fresh room `/r/<slug>`; the dot by the room name is green once the server is reached. If the network is not the cloud, use graph → reset.

You should land on 20 nodes, a HUD like `20/20 live · 960×540`, and a soft white cloud in the viewer. Headers: green CHOP, orange POP, purple MAT, gray COMP, pink TOP. Wires stay inside a family.

1. **Time.** ❚❚ freezes `absTime` and the cloud, ▶ resumes, ↺ snaps to 0.00. Node previews and the viewer keep updating while paused.
2. **Viewer follows selection.** lfo_amp shows a green scope; xform shows points (drag to tumble, wheel to dolly); bloom/out show the image, letterboxed. Clicking empty network goes back to out.
3. **Parameters and expressions.** Pause, click noise. `amp` is `op('e_amp')['chan1']` with ƒ on. Turn ƒ off and drag 0 → 4: the cloud collapses, then blows apart. A bad expression (`absTime.frame`, `1/0`) turns red after a short pause and the last good value keeps cooking.
4. **Palette.** Tab (opens at the cursor, on the selected node's family), `add`, or double-click empty network. Type `noise` (or just `nse`), Enter: the node hangs off the cursor; click to put it down unwired, Shift-click to wire it after the one selected node, Escape or right-click to drop it. It is selected and its pars show on the right. Opened near the bottom or right edge, the palette stays on screen.
4b. **Wires.** Drag a wire onto an inlet that already has one: it replaces it. Drag from a wired inlet onto empty network to pull the wire out, or onto another outlet to rewire it. A wire end dropped on an inlet that refuses it (another family, a loop) stays where it was. Drop a wire from an outlet (or an inlet) on empty network: the palette opens there and the new op is wired to it. Double-click a wire to insert an op into it.
4c. **Lit points.** Add a phong MAT, point geo.mat at it, add a light COMP: the cloud turns into shaded spheres. Move the light's t, switch lighttype to distant or ambient; render.lights `*` uses every light; renaming a light follows into render.lights.
5. **CHOP onto a par.** Drag the ƒ chip on a CHOP header onto a numeric par (also works on shader uniforms). The row becomes `op('<label>')['chan1']` with ƒ on.
6. **Rename, bypass, delete, undo.** Click a selected node's label to rename; expressions that used the old name follow. The `b` button bypasses (noise bypassed freezes the displacement). Delete removes. Ctrl+Z / Ctrl+Shift+Z (or ↶ ↷) undo only your own edits.
7. **Shaders.** graph → examples → melt (confirm replaces the room's graph). Double-click a shader TOP: the GLSL drawer opens; edit and it recompiles, the last good program keeps cooking on error. Removing an `iChannel` use does not delete its wire.
8. **Audio.** The header audio control picks off (test signal), mic, or a looping file (pick, or drop it on the network). Audio is per tab. Try graph → examples → pulse-nebula or spectrum-ring.
9. **Two people.** Open the room link in a second tab: nodes, wires, pars, renames and shader text converge; you see each other's caret in the editor. Undo in one tab never undoes the other's edits.
10. **Files.** graph → export downloads the graph JSON; graph → import (or dropping a .json on the network) loads it for the whole room.

Fixed sessions (`?graph=/tests/graphs/<name>.json&t=2&frame=120`) cook one instant and never join a room; the playbar is disabled there.
