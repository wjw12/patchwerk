import { useEffect, useRef, useState } from "react";
import { engine } from "./engine/engine";
import { buildGraph } from "./graph-file";
import { publish } from "./probe";
import { readSession } from "./session";
import { useGraph } from "./store";
import { Assistant } from "./ui/Assistant";
import { Editor } from "./ui/Editor";
import { Flow } from "./ui/Flow";
import { Header } from "./ui/Header";
import { Params } from "./ui/Params";
import { Viewer } from "./ui/Viewer";

export function App() {
  const gl = useRef<HTMLCanvasElement>(null);
  const viewer = useRef(readSession().viewer);
  const [drawer, setDrawer] = useState(260);
  const [readyToCook, setReadyToCook] = useState(() => readSession().graph == null);
  const shaderSelected = useGraph((state) => state.nodes.some((node) => node.selected && node.data.kind === "shader"));

  useEffect(() => {
    const session = readSession();
    if (!session.graph) return;
    let dead = false;
    void (async () => {
      try {
        const response = await fetch(session.graph!);
        if (!response.ok) throw new Error(`failed to load ${session.graph}: ${response.status}`);
        const built = buildGraph(await response.json());
        if (dead) return;
        viewer.current = built.viewer;
        useGraph.getState().replace(built.nodes, built.edges);
        useGraph.getState().requestFit();
        setReadyToCook(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "graph failed to load";
        useGraph.getState().setGpuError(message);
        publish({ ready: true, error: message, width: 0, height: 0, rgba: "" });
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!readyToCook) return;
    const canvas = gl.current;
    if (!canvas) return;
    const session = readSession();
    engine.attach(canvas, { ...session, viewer: viewer.current });
    return () => engine.stop();
  }, [readyToCook]);

  return (
    <div className="app">
      <canvas ref={gl} className="gl-host" />
      <Header />
      <div className="stage">
        <Assistant />
        <Flow />
        <aside className="side">
          <Viewer />
          <Params />
        </aside>
      </div>
      {shaderSelected && <Editor height={drawer} onResize={setDrawer} />}
    </div>
  );
}
