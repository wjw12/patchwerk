import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { buildGraph, templateFile, type GraphFile } from "./graph-file";
import { isNewRoomPath, newRoomPath, rememberRoom, roomFromUrl, takeHandOff } from "./room";
import { readSession } from "./session";
import { useGraph } from "./store";
import { connect } from "./sync";
import { Landing } from "./ui/landing/Landing";
import "./styles.css";
import "@xyflow/react/dist/style.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
const render = (node: ReactNode) => createRoot(root).render(<StrictMode>{node}</StrictMode>);

void boot();

async function boot(): Promise<void> {
  // Visual tests run a fixed graph alone, outside any room.
  if (readSession().fixed) return render(<App />);
  if (isNewRoomPath()) {
    location.replace(newRoomPath(new URLSearchParams(location.search).get("from") ?? undefined));
    return;
  }
  const room = roomFromUrl();
  if (!room) return render(<Landing />);
  await startFrom(room);
  rememberRoom(room);
  connect(room);
  render(<App />);
}

/**
 * An empty room is seeded from this tab's graph on first sync, so load what the room should
 * start from: a graph handed over by duplicate / open file, else `?from=<template>`, else the
 * demo. A room that already has a graph ignores all of this.
 */
async function startFrom(room: string): Promise<void> {
  const query = new URLSearchParams(location.search);
  const from = query.get("from");
  if (from != null) {
    query.delete("from");
    const rest = query.toString();
    history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}`);
  }
  try {
    const file = (takeHandOff(room) as GraphFile | null) ?? (from ? await templateFile(from) : null);
    if (!file) return;
    const built = buildGraph(file);
    useGraph.getState().replace(built.nodes, built.edges);
  } catch (error) {
    console.warn(`room ${room} starts from the demo:`, error);
  }
}
