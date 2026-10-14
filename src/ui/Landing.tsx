// `/`: start a room from a template or a file, or go back to a recent one.
import { useState } from "react";
import { forgetRoom, recentRooms } from "../room";
import { FileButton, openFileInNewRoom, TemplateGrid } from "./Templates";

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function Landing() {
  const [recent, setRecent] = useState(recentRooms);

  return (
    <main className="landing">
      <header>
        <strong>patchwerk</strong>
        <p>
          A multiplayer patcher for generative art. A room is one live patch: everyone with its link sees and edits the
          same graph, and it saves itself.
        </p>
      </header>

      <section>
        <div className="landing-head">
          <h2>Start a new room</h2>
          <FileButton label="open a .json file…" onFile={(file) => void openFileInNewRoom(file)} />
        </div>
        <TemplateGrid />
      </section>

      {recent.length > 0 && (
        <section>
          <h2>Your recent rooms</h2>
          <ul className="recent">
            {recent.map((item) => (
              <li key={item.room}>
                <a href={`/r/${item.room}`}>{item.room}</a>
                <span>{ago(item.at)}</span>
                <button
                  type="button"
                  title="remove from this list (the room itself stays)"
                  onClick={() => {
                    forgetRoom(item.room);
                    setRecent(recentRooms());
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
