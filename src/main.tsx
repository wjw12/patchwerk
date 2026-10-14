import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ensureRoom } from "./room";
import { readSession } from "./session";
import { connect } from "./sync";
import "./styles.css";
import "@xyflow/react/dist/style.css";

// Visual tests run a fixed graph alone; everything else lives in a room.
if (!readSession().fixed) {
  const room = ensureRoom();
  if (room) connect(room);
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
