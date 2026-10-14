// `/`: what patchwerk is, a template to start a room from, and this browser's recent rooms.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/jetbrains-mono";
import "./landing.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { forgetRoom, recentRooms } from "../../room";
import { FileButton, openFileInNewRoom, TemplateGrid } from "../Templates";
import { hydraHero, shaderPreview, type HydraStage, type PreviewCursor } from "./gl";
import { AGENT, AGENT_ADDED, AGENT_BEFORE, CURSORS, DIGITS, SPECTRUM, TUNNEL } from "./shaders";

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function Logo() {
  return (
    <svg className="lp-logo" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M10 3h19l-6 26H4z" fill="var(--pink)" />
      <path d="M12.5 10.5c7 0 1.5 11 8.5 11" stroke="var(--ink)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="12.5" cy="10.5" r="2.8" fill="var(--ink)" />
      <circle cx="20.5" cy="21.5" r="2.8" fill="var(--ink)" />
    </svg>
  );
}

const SITE = "patchwerk.heurist.xyz";

function Announce() {
  const [pinned, setPinned] = useState(false);
  return (
    <div className="lp-announce">
      <span>Join Frontiers 2026 room and hack shaders together</span>
      <a href="/r/frontiers-2026-demo?from=frontiers2026">Join room →</a>
      <div className={`lp-qr${pinned ? " is-pinned" : ""}`}>
        <button type="button" onClick={() => setPinned((open) => !open)}>
          QR code
        </button>
        <div className="lp-qr-pop">
          <figure>
            <img src="/qr-patchwerk.svg" alt={`QR code for ${SITE}`} />
            <figcaption>{SITE}</figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav className={`lp-nav${scrolled ? " is-scrolled" : ""}`}>
      <a className="lp-brand" href="/">
        <Logo />
        <span>patchwerk</span>
      </a>
      <div className="lp-links">
        <a href="#how">How it works</a>
        <a href="#operators">Operators</a>
        <a href="#templates">Templates</a>
      </div>
      <div className="lp-actions">
        <FileButton label="Open file" onFile={(file) => void openFileInNewRoom(file)} />
        <a className="lp-btn is-solid" href="/new?from=demo">
          New room
        </a>
      </div>
    </nav>
  );
}

const STAGES: { stage: HydraStage; name: string; detail: string }[] = [
  { stage: "o1", name: "o1", detail: "noise · row sort" },
  { stage: "o5", name: "o5", detail: "column sort" },
  { stage: "post", name: "post", detail: "posterize · dither" },
];

const CHAT = [
  { who: "ada", text: "more pink in the dither, less grain" },
  { who: "agent", text: "post.glsl: grain 0.19 → 0.08, dither threshold up. Compiled, tested, live." },
  { who: "ada", text: "now make the rows tear on the kick" },
  { who: "agent", text: "o1.glsl: row offset driven by audioband. Live." },
];

function HeroChat() {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => setShown((n) => (n % CHAT.length) + 1), 2600);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="lp-card lp-chat" data-card="chat">
      <header>
        <i className="dot is-violet" />
        <span>agent</span>
        <em>editing post</em>
      </header>
      <ol>
        {CHAT.slice(Math.max(0, shown - 2), shown).map((line) => (
          <li key={line.text} className={line.who === "agent" ? "is-agent" : ""}>
            <b>{line.who}</b>
            {line.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Hero() {
  const hero = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = hero.current!;
    const q = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
    const windows = STAGES.map(({ stage }) => ({ el: q<HTMLElement>(`[data-card="${stage}"] .lp-window`), stage, radius: 10 }));
    const port = (stage: string, side: "in" | "out") => q<HTMLElement>(`[data-card="${stage}"] .port.is-${side}`);
    const wires = [
      { from: port("o1", "out"), to: port("o5", "in"), paths: root.querySelectorAll<SVGPathElement>('[data-wire="o1-o5"]') },
      { from: port("o1", "out"), to: port("post", "in"), paths: root.querySelectorAll<SVGPathElement>('[data-wire="o1-post"]') },
      { from: port("o5", "out"), to: port("post", "in"), paths: root.querySelectorAll<SVGPathElement>('[data-wire="o5-post"]') },
    ];
    const cursors = [q<HTMLElement>('[data-cursor="ada"]'), q<HTMLElement>('[data-cursor="agent"]')];

    return hydraHero(canvas.current!, {
      windows: () => windows.filter((item) => item.el.offsetParent !== null),
      onFrame: (seconds) => {
        const box = root.getBoundingClientRect();
        const center = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top] as const;
        };
        for (const wire of wires) {
          if (wire.from.offsetParent === null || wire.to.offsetParent === null) continue;
          const [x1, y1] = center(wire.from);
          const [x2, y2] = center(wire.to);
          const pull = Math.max(70, Math.abs(x2 - x1) * 0.5);
          const d = `M${x1},${y1} C${x1 + pull},${y1} ${x2 - pull},${y2} ${x2},${y2}`;
          wire.paths.forEach((path) => path.setAttribute("d", d));
        }
        const w = box.width;
        const h = box.height;
        cursors[0]!.style.transform = `translate(${w * (0.33 + 0.1 * Math.sin(seconds * 0.43))}px, ${h * (0.7 + 0.08 * Math.sin(seconds * 0.71 + 1))}px)`;
        cursors[1]!.style.transform = `translate(${w * (0.76 + 0.06 * Math.sin(seconds * 0.31 + 2))}px, ${h * (0.42 + 0.14 * Math.cos(seconds * 0.5))}px)`;
      },
    });
  }, []);

  return (
    <header className="lp-hero" ref={hero}>
      <canvas ref={canvas} className="lp-hero-canvas" aria-hidden="true" />
      <div className="lp-hero-grid" aria-hidden="true" />

      <svg className="lp-wires" aria-hidden="true">
        {["o1-o5", "o1-post", "o5-post"].map((id) => (
          <g key={id}>
            <path data-wire={id} className="wire" />
            <path data-wire={id} className="wire-pulse" pathLength={100} />
          </g>
        ))}
      </svg>

      {STAGES.map(({ stage, name, detail }) => (
        <div key={stage} className="lp-card lp-node" data-card={stage}>
          <header>
            <i className="port is-in" />
            <span>{name}</span>
            <em>{detail}</em>
            <i className="port is-out" />
          </header>
          <div className="lp-window">{stage === "post" && <span className="lp-tag">● out</span>}</div>
        </div>
      ))}
      <HeroChat />

      <div className="lp-cursor" data-cursor="ada">
        <CursorArrow />
        <span>ada</span>
      </div>
      <div className="lp-cursor is-agent" data-cursor="agent">
        <CursorArrow />
        <span>agent</span>
      </div>

      <div className="lp-hero-copy">
        <h1>
          <span className="lp-badge" data-text="GM.">
            GM.
          </span>
          <span className="lp-badge is-second" data-text="Ship pixels">
            Ship pixels
          </span>
        </h1>
        <p>
          Like TouchDesigner in your browser. Create real-time visuals with your friends and AI agent.
        </p>
        <div className="lp-cta">
          <a className="lp-btn is-solid is-big" href="/new?from=demo">
            Start a room
          </a>
          <a className="lp-btn is-big" href="/new?from=frontiers2026">
            Fork this patch
          </a>
        </div>
      </div>
    </header>
  );
}

function CursorArrow() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 1.5l11 6.2-4.9 1.2L5.9 14z" />
    </svg>
  );
}

const TICKER = ["TOP", "mainImage()", "CHOP", "iChannel0", "POP", "// @feedback", "MAT", "WebGL2", "COMP", "// @prev", "DAT", "float framebuffers", "audio texture", "one link per room"];

function Ticker() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="lp-ticker" aria-hidden="true">
      <div>
        {items.map((item, i) => (
          <span key={i}>
            {item}
            <i />
          </span>
        ))}
      </div>
    </div>
  );
}

const KEYWORDS = /^(void|float|int|vec[234]|ivec2|const|for|if|return|out|in)$/;
const BUILTINS = /^(iTime|iResolution|iChannel\d|iCursors|iCursorCount|iMouse|fragCoord|fragColor|mainImage)$/;

/** Just enough GLSL highlighting for the snippets on this page. */
function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const comment = line.indexOf("//");
  const code = comment >= 0 ? line.slice(0, comment) : line;
  for (const token of code.split(/(\b[A-Za-z_]\w*\b|\b\d[\d.]*\b)/)) {
    if (!token) continue;
    const key = out.length;
    if (KEYWORDS.test(token)) out.push(<i key={key} className="k">{token}</i>);
    else if (BUILTINS.test(token)) out.push(<i key={key} className="b">{token}</i>);
    else if (/^\d/.test(token)) out.push(<i key={key} className="n">{token}</i>);
    else out.push(token);
  }
  if (comment >= 0) out.push(<i key="c" className="c">{line.slice(comment)}</i>);
  return out;
}

interface Feature {
  title: string;
  body: string;
  file: string;
  code: string;
}

const FEATURES: Feature[] = [
  {
    title: "Paste from ShaderToy",
    body: "mainImage, iTime, iMouse, iChannel0–3: a ShaderToy shader pastes in and runs. // @feedback hands a node its last frame, // @prev lets buffers read each other.",
    file: "tunnel.glsl",
    code: TUNNEL,
  },
  {
    title: "Sound in, light out",
    body: "A mic or a looping file becomes a 512×2 audio texture and an audioband CHOP. Wire the kick into any parameter with an expression.",
    file: "spectrum.glsl",
    code: SPECTRUM,
  },
  {
    title: "An agent in the editor",
    body: "Say what the picture should do. The agent edits the shader next to you, and every edit compiles and tests before it reaches the screen, so a bad line never blanks the show.",
    file: "tear.glsl",
    code: AGENT,
  },
  {
    title: "One link, one room",
    body: "Everyone with the link edits the same graph, drags the same sliders and types in the same shader. Even your cursor is a uniform.",
    file: "cursors.glsl",
    code: CURSORS,
  },
];

const AGENT_INDEX = 2;
const ROOM_INDEX = 3;
const ADVANCE_MS = 9000;

function roomCursors(t: number): PreviewCursor[] {
  return [
    { x: 0.5 + 0.28 * Math.sin(t * 0.61), y: 0.5 + 0.24 * Math.sin(t * 0.93 + 1) },
    { x: 0.5 + 0.3 * Math.cos(t * 0.47 + 2), y: 0.5 + 0.26 * Math.sin(t * 0.77) },
  ];
}

function Features() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [typed, setTyped] = useState(Infinity);
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<ReturnType<typeof shaderPreview> | null>(null);
  const marks = useRef<(HTMLDivElement | null)[]>([]);
  const feature = FEATURES[active]!;
  const addedText = AGENT_ADDED.map((i) => AGENT.split("\n")[i]!.length);
  const addedTotal = addedText.reduce((a, b) => a + b, 0);

  useEffect(() => {
    const room = canvas.current!.parentElement!;
    preview.current = shaderPreview(canvas.current!, TUNNEL, {
      audio: true,
      cursors: roomCursors,
      onFrame: (seconds) => {
        const box = room.getBoundingClientRect();
        roomCursors(seconds).forEach((cursor, i) => {
          const el = marks.current[i];
          if (el) el.style.transform = `translate(${cursor.x * box.width}px, ${(1 - cursor.y) * box.height}px)`;
        });
      },
    });
    return () => preview.current?.stop();
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => setActive((i) => (i + 1) % FEATURES.length), ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [active, auto]);

  useEffect(() => {
    if (active !== AGENT_INDEX) {
      setTyped(Infinity);
      preview.current?.setSource(feature.code);
      return;
    }
    preview.current?.setSource(AGENT_BEFORE);
    setTyped(0);
    let count = 0;
    const id = window.setInterval(() => {
      count += 3;
      setTyped(count);
      if (count >= addedTotal) {
        window.clearInterval(id);
        preview.current?.setSource(AGENT);
      }
    }, 28);
    return () => window.clearInterval(id);
  }, [active]);

  let budget = typed;
  const lines = feature.code.split("\n").map((line, i) => {
    const added = active === AGENT_INDEX && AGENT_ADDED.includes(i);
    let text = line;
    if (added) {
      text = line.slice(0, Math.max(0, budget));
      budget -= line.length;
    }
    return (
      <div key={`${active}-${i}`} className={added ? "is-added" : ""}>
        <span className="ln">{i + 1}</span>
        <code>{highlight(text)}</code>
      </div>
    );
  });

  return (
    <section className="lp-section lp-how" id="how">
      <div className="lp-heading" data-reveal>
        <span className="lp-badge is-small">How</span>
        <span className="lp-badge is-small is-mark">
          <Logo />
        </span>
        <span className="lp-badge is-small">cooks</span>
      </div>
      <p className="lp-lede" data-reveal>
      </p>

      <div className="lp-how-grid" data-reveal>
        <div className="lp-stage">
          <div className="lp-editor">
            <div className="lp-editor-bar">
              <i />
              <i />
              <i />
              <span>{feature.file}</span>
              {active === AGENT_INDEX && <em className="lp-agent-chip">agent editing</em>}
            </div>
            {active === AGENT_INDEX && (
              <div className="lp-agent-ask">
                <b>you</b> make the bars tear on every kick, flash a few rows lime
              </div>
            )}
            <div className="lp-code">{lines}</div>
          </div>
          <div className="lp-preview">
            <canvas ref={canvas} />
            {active === ROOM_INDEX &&
              ["ada", "agent"].map((name, i) => (
                <div key={name} className={`lp-cursor is-small${i ? " is-agent" : ""}`} ref={(el) => void (marks.current[i] = el)}>
                  <CursorArrow />
                  <span>{name}</span>
                </div>
              ))}
          </div>
        </div>

        <div className="lp-accordion">
          {FEATURES.map((item, i) => (
            <button
              key={item.title}
              type="button"
              className={i === active ? "is-open" : ""}
              onClick={() => {
                setAuto(false);
                setActive(i);
              }}
            >
              <span className="lp-acc-title">
                {item.title}
                <i>{i === active ? "–" : "+"}</i>
              </span>
              {i === active && <span className="lp-acc-body">{item.body}</span>}
              {i === active && auto && <span className="lp-acc-progress" key={active} />}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAMILIES = [
  { name: "TOP", what: "Images on the GPU" },
  { name: "CHOP", what: "Signals" },
  { name: "POP", what: "Point clouds" },
  { name: "MAT", what: "Materials" },
  { name: "COMP", what: "Cameras" },
  { name: "DAT", what: "Text" },
];

function Families() {
  return (
    <section className="lp-section lp-families" id="operators">
      <div className="lp-split" data-reveal>
        <h2 className="lp-h2">
          Visual programming.
          <br />
          Collaborative.
        </h2>
        <p className="lp-lede is-left">
        </p>
      </div>
      <div className="lp-family-grid">
        {FAMILIES.map((family, i) => (
          <article key={family.name} className={`lp-family is-${family.name.toLowerCase()}`} data-reveal style={{ transitionDelay: `${i * 60}ms` }}>
            <span className="lp-family-what">{family.what}</span>
            <strong>{family.name}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function Templates() {
  const [recent, setRecent] = useState(recentRooms);
  return (
    <section className="lp-section lp-templates" id="templates">
      <div className="lp-split" data-reveal>
        <div>
          <span className="lp-eyebrow">Templates</span>
          <h2 className="lp-h2">Start your patch</h2>
        </div>
        <div className="lp-templates-actions">
          <p>Share a room with your friends and start collaborating.</p>
          <div>
            <a className="lp-btn is-solid" href="/new?from=blank">
              New room
            </a>
            <FileButton label="Open a file" onFile={(file) => void openFileInNewRoom(file)} />
          </div>
        </div>
      </div>
      <div data-reveal>
        <TemplateGrid />
      </div>

      {recent.length > 0 && (
        <div className="lp-recent" data-reveal>
          <span className="lp-eyebrow">Your recent rooms</span>
          <ul>
            {recent.map((item) => (
              <li key={item.room}>
                <i className="dot" />
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
        </div>
      )}
    </section>
  );
}

function Closing() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => shaderPreview(canvas.current!, DIGITS).stop, []);
  return (
    <section className="lp-closing">
      <canvas ref={canvas} aria-hidden="true" />
      <div className="lp-closing-copy" data-reveal>
        <span className="lp-badge" data-text="Paste. Patch. Play.">
          Paste. Patch. Play.
        </span>
        <div className="lp-cta">
          <a className="lp-btn is-solid is-big" href="/new?from=demo">
            Start a room
          </a>
          <a className="lp-btn is-big" href="#templates">
            Browse templates
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-row">
        <a className="lp-brand" href="/">
          <Logo />
          <span>patchwerk</span>
        </a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#operators">Operators</a>
          <a href="#templates">Templates</a>
          <a href="/new?from=blank">New room</a>
          <a href="https://github.com/wjw12/patchwerk" target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </nav>
      </div>
      <div className="lp-footer-mark" aria-hidden="true">
        PATCHWERK
      </div>
      <div className="lp-footer-row is-small">
        <span>The multiplayer patcher for the browser</span>
        <span>Runs on WebGL2 in any modern browser</span>
      </div>
    </footer>
  );
}

export function Landing() {
  useEffect(() => {
    document.documentElement.classList.add("lp-doc");
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          seen.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => seen.observe(el));
    return () => {
      seen.disconnect();
      document.documentElement.classList.remove("lp-doc");
    };
  }, []);

  return (
    <main className="lp">
      <Announce />
      <Nav />
      <Hero />
      <Ticker />
      <Features />
      <Families />
      <Templates />
      <Closing />
      <Footer />
    </main>
  );
}
