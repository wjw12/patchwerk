# Claude Agent SDK reference (for Patchwerk `server/`)

Researched 2026-10-14 from the official docs. Docs moved: `docs.claude.com/en/api/agent-sdk/*` 301s to `platform.claude.com/...`, which 307s to `https://code.claude.com/docs/en/agent-sdk/<page>`. Package: `@anthropic-ai/claude-agent-sdk`. The latest version was not confirmed (npm page returned 403); search results showed 0.3.207 / 0.3.212, and the reference page mentions 0.3.191 and 0.3.282+ features. Check with `bun pm view @anthropic-ai/claude-agent-sdk version`.

Our use: server-side agent in the `server/` package, API key auth, custom in-process tools over the graph (no filesystem or bash), PNG frames back to the model, browser clients over WebSocket.

## 0. Big picture (read first)

Source: https://code.claude.com/docs/en/agent-sdk/hosting and /overview

- The SDK is Claude Code packaged as a library. `query()` spawns a `claude` CLI subprocess and talks to it over stdio. The agent loop runs in that subprocess; our tools run in our process via an in-process MCP bridge.
- One agent session = one subprocess. N clients = N subprocesses. Budget about 1 GiB RAM, 1 CPU, 5 GiB disk per agent as a starting point.
- The subprocess writes JSONL transcripts to local disk (`~/.claude/projects/...`) by default. Disable with `persistSession: false` (TS only).
- The default system prompt is minimal (tool calling only). It differs from `claude -p`.
- Branding rule: do not call our product "Claude Code" or mimic its look. "Claude Agent" or "<Name> Powered by Claude" is fine.
- Alternative if the subprocess is unacceptable: the plain Messages API with `@anthropic-ai/sdk` and a hand-written or tool-runner loop. Same custom tools, no CLI. This is a design option, not an SDK feature.

## 1. Install and runtime

Source: https://code.claude.com/docs/en/agent-sdk/typescript, /hosting

```bash
bun add @anthropic-ai/claude-agent-sdk zod     # in server/
export ANTHROPIC_API_KEY=sk-ant-...            # the subprocess reads it from its env
```

- The package ships a native Claude Code binary as an optional dependency (for example `@anthropic-ai/claude-agent-sdk-linux-x64`). No separate Claude Code or Node install is needed for the CLI. The bundled binary version is pinned to the SDK version.
- If the package manager skips optional deps, startup throws `Native CLI binary for <platform>-<arch> not found`. Fix: allow optional deps, or set `pathToClaudeCodeExecutable` to an installed `claude` binary.
- Hosting docs say Node.js 18+ for the TS SDK. `options.executable` accepts `'bun' | 'deno' | 'node'` and is auto-detected, so Bun is a supported JS runtime. Whether the SDK's JS side runs cleanly under `bun run` in our setup is (unverified). Smoke-test it.
- `bun build --compile` single-file binaries: the bundled CLI is not resolvable inside `$bunfs`. Use `extractFromBunfs()` from `@anthropic-ai/claude-agent-sdk/extract` (v0.3.144+) and pass the result as `pathToClaudeCodeExecutable`. Not needed if we run `bun run server/index.ts` in a container.
- Bundler entry `@anthropic-ai/claude-agent-sdk/core` exists (v0.3.282+). Do not load root and `/core` in the same process.
- Zod: `tool()` accepts Zod 3 or Zod 4 raw shapes.
- Auth: `ANTHROPIC_API_KEY`. Also supported: Bedrock/Vertex/Foundry via env flags (for example `CLAUDE_CODE_USE_BEDROCK=1`). Anthropic does not allow third parties to offer claude.ai login; use API keys.
- Network: the subprocess needs outbound HTTPS to `api.anthropic.com`.

## 2. `query()`

Source: https://code.claude.com/docs/en/agent-sdk/typescript

```ts
function query(args: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query;
// Query extends AsyncGenerator<SDKMessage, void> + control methods
```

Key options (names and defaults from the reference):

| Option | Notes |
|---|---|
| `systemPrompt` | `string`, `string[]`, `{type:'custom',prompt}`, or `{type:'preset',preset:'claude_code',append?,excludeDynamicSections?}`. Default `undefined` = minimal prompt. |
| `model` | Alias or full id string. Default comes from the CLI. |
| `tools` | Built-in tool set. `[]` removes ALL built-ins (MCP tools unaffected). `['Read','Grep']` keeps only those. Preset form `{type:'preset',preset:'claude_code'}`. |
| `allowedTools` | Auto-approve list (permission layer). Does NOT restrict availability. Use `mcp__<server>__<tool>` or `mcp__<server>__*`. |
| `disallowedTools` | Bare name removes the tool from context. Scoped rule like `Bash(rm *)` denies matching calls. `["*"]` removes everything. |
| `mcpServers` | `Record<string, McpServerConfig>` (stdio, sse, http, sdk). The key becomes the server segment in tool names. |
| `permissionMode` | `default`, `dontAsk`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`. See section 5. |
| `canUseTool` | Runtime approval callback. |
| `maxTurns` | Max tool-use round trips. Exceeding it yields `error_max_turns`. |
| `cwd` | Default `process.cwd()`. Give each session its own dir. |
| `settingSources` | Default is all (`user`, `project`, `local`). Pass `[]` to skip filesystem settings and CLAUDE.md. |
| `includePartialMessages` | Emits `stream_event` messages for token streaming. |
| `resume`, `continue`, `forkSession`, `persistSession`, `sessionStore` | Section 4. |
| `abortController` | Cancels the operation. |
| `env` | REPLACES the subprocess env. Spread `...process.env` or you lose `PATH` and `ANTHROPIC_API_KEY`. |
| `pathToClaudeCodeExecutable`, `executable` | See section 1. |
| `settings` | Inline settings object or JSON path (for example `{ includeGitInstructions: false }`). |
| `maxBudgetUsd` | Spend cap for the call (result subtype `error_max_budget_usd`). Mentioned in the cost docs. |

### Locked-down config for Patchwerk

```ts
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: inputStream,                       // see section 4
  options: {
    model: "claude-opus-5-5",
    systemPrompt: PATCHWERK_PROMPT,          // custom string, section 6
    tools: [],                               // no Read/Bash/Edit/etc.
    mcpServers: { patchwerk: graphServer },
    allowedTools: ["mcp__patchwerk__*"],
    permissionMode: "dontAsk",               // anything not allowed is denied, canUseTool never called
    settingSources: [],                      // no CLAUDE.md / settings.json from disk
    cwd: `/tmp/patchwerk-agents/${roomId}`,  // scratch, empty
    maxTurns: 25,
    includePartialMessages: true,
    persistSession: false,                   // or true if you want resume (section 4)
    env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    abortController: ac,
  },
});
```

Notes:
- `tools: []` is documented as "Claude can only use your MCP tools." Bare `disallowedTools: ["Bash", ...]` is the alternative.
- The init message's `tools` array lists what is actually available. Log it once at startup to verify no built-ins leaked (for example `ToolSearch` or `Task`; tool search is on by default and defers SDK MCP tools; `alwaysLoad: true` in `tool()` extras or `createSdkMcpServer` options keeps schemas in the initial prompt). Whether `ToolSearch`/`Agent` stay present with `tools: []` is (unverified).
- Auto memory loads into the system prompt regardless of `settingSources`; set `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` for multi-tenant servers.

### Message stream (`SDKMessage`)

```ts
type SDKMessage = SDKAssistantMessage | SDKUserMessage | SDKUserMessageReplay | SDKResultMessage
  | SDKSystemMessage | SDKPartialAssistantMessage /* ... plus status, hook, task, rate-limit, api-retry, compact-boundary */;
```

- `system` / `subtype:"init"`: `{ session_id, model, cwd, tools: string[], mcp_servers: {name,status}[], permissionMode, apiKeySource, claude_code_version, ... }`. Check `mcp_servers` shows `patchwerk` connected.
- `assistant`: `{ uuid, session_id, message: BetaMessage, parent_tool_use_id }`. `message.content` blocks are `text`, `thinking`, `tool_use`. One API response can produce several assistant messages sharing `message.id`.
- `user`: tool results flowing back, carrying `tool_result` blocks. Includes our image blocks.
- `stream_event` (only with `includePartialMessages`): `{ event: BetaRawMessageStreamEvent, parent_tool_use_id: null, ... }`. Use `event.type === "content_block_delta"` with `delta.type === "text_delta"` to forward tokens to the browser.
- `result`: success `{subtype:"success", result: string, session_id, num_turns, duration_ms, total_cost_usd, usage, modelUsage, permission_denials, stop_reason, is_error}`. Error subtypes: `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`, each with `errors: string[]`.
- Single-shot `query()` THROWS after yielding an error result. Wrap the loop in try/catch.

```ts
for await (const m of q) {
  switch (m.type) {
    case "system": if (m.subtype === "init") ws.send(j({ t: "init", tools: m.tools })); break;
    case "stream_event":
      if (m.event.type === "content_block_delta" && m.event.delta.type === "text_delta")
        ws.send(j({ t: "text", d: m.event.delta.text }));
      break;
    case "assistant":
      for (const b of m.message.content) if (b.type === "tool_use") ws.send(j({ t: "tool", name: b.name, input: b.input }));
      break;
    case "result": ws.send(j({ t: "done", ok: m.subtype === "success", cost: m.total_cost_usd })); break;
  }
}
```

## 3. Custom tools (graph + image)

Source: https://code.claude.com/docs/en/agent-sdk/custom-tools

```ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const getGraph = tool(
  "get_graph", "Return all nodes, wires and parameters as JSON.",
  {},                                           // empty raw shape = no args
  async () => ({ content: [{ type: "text", text: JSON.stringify(store.snapshot()) }] }),
  { annotations: { readOnlyHint: true } },      // allows parallel calls with other read-only tools
);

const setShader = tool(
  "set_shader_code", "Replace the GLSL ES 3.00 body of a shader TOP.",
  { nodeId: z.string(), code: z.string().describe("full shader source") },
  async ({ nodeId, code }) => {
    try { await store.setCode(nodeId, code); return { content: [{ type: "text", text: "ok" }] }; }
    catch (e) { return { content: [{ type: "text", text: `compile failed: ${e}` }], isError: true }; }
  },
);

const viewNode = tool(
  "view_node", "Render a node and return a PNG so you can look at it.",
  { nodeId: z.string(), size: z.number().int().min(64).max(1024).optional() },
  async ({ nodeId, size }) => {
    const png: Buffer = await renderPng(nodeId, size ?? 512);  // our own pipeline
    return { content: [
      { type: "text", text: `Frame of ${nodeId}` },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ] };
  },
  { annotations: { readOnlyHint: true } },
);

export const graphServer = createSdkMcpServer({
  name: "patchwerk", version: "1.0.0",
  tools: [getGraph, setShader, viewNode],
  // timeout?: ms per tool call (whole number >= 1000); instructions?: string; alwaysLoad?: boolean
});
```

Facts:
- Signature: `tool(name, description, zodRawShape, handler(args, extra) => Promise<CallToolResult>, extras?: { annotations?, searchHint?, alwaysLoad? })`. The schema is a raw shape (an object of Zod fields), not `z.object(...)`.
- Full tool name the model sees and that `allowedTools` needs: `mcp__<serverKey>__<toolName>`, where `serverKey` is the key in `mcpServers`. Wildcard `mcp__patchwerk__*` is allowed.
- Result `content` blocks: `text`, `image`, `audio`, `resource`, `resource_link`; mixing is fine. Optional `structuredContent` (TS only) and `isError`.
- Image block: `{ type: "image", data: <raw base64, NO data: prefix>, mimeType: "image/png" }`. `mimeType` is required. PNG/JPEG/GIF/WebP reach the model as vision input; other types are saved to disk and the model gets a path as text. There is no URL field.
- `structuredContent` caveat: when set, text blocks in `content` are NOT forwarded to the model (only image/resource blocks plus the JSON). So for text + image, do not set `structuredContent`; just return both blocks.
- Uncaught handler exceptions become an error result with the raw message and the loop continues. Prefer returning `isError: true` with a message that tells the model what to fix (for example shader compile log).
- Image size: no documented limit in these pages (unverified). Keep PNGs small (about 512 px) since they count as input tokens every later turn, and they stay in context. Consider a `view_node` size cap.
- Tools run in our process, so they can call into the same zustand/Yjs state directly, or proxy to the browser over WebSocket (for example ask a connected client to render and send back a PNG). Per-call `timeout` on the server config covers slow round trips.

## 4. Multi-turn: one long-lived session per client

Source: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode, /sessions

Streaming input mode (recommended): pass an `AsyncIterable<SDKUserMessage>` as `prompt`. One `query()` = one subprocess = one persistent conversation. It supports queued messages, interrupt, `setPermissionMode`/`setModel`, and image attachments. Each user turn emits its own `result` message.

```ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private q: SDKUserMessage[] = []; private wake?: () => void; private closed = false;
  push(text: string) {
    this.q.push({ type: "user", parent_tool_use_id: null, message: { role: "user", content: text } });
    this.wake?.();
  }
  close() { this.closed = true; this.wake?.(); }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.q.length) { yield this.q.shift()!; continue; }
      if (this.closed) return;
      await new Promise<void>(r => (this.wake = r));
    }
  }
}

// per client / room
const input = new InputQueue();
const ac = new AbortController();
const q = query({ prompt: input, options: { /* section 2 config */ abortController: ac } });
(async () => { for await (const m of q) forward(ws, m); })().catch(onErr);

ws.onmessage = e => input.push(JSON.parse(e.data).text);   // follow-ups just push
```

User message with an image (for example a canvas screenshot from the browser):
`content: [{type:"text",text:"..."},{type:"image",source:{type:"base64",media_type:"image/png",data:b64}}]`.

Interrupt / stop:
- `await q.interrupt()` stops the current turn but keeps the session (streaming input mode only). Returns a receipt listing `still_queued` message UUIDs on newer CLIs.
- `ac.abort()` or `q.close()` ends the whole query and subprocess. Call `input.close()` too.
- `SDKUserMessage.priority?: "now" | "next" | "later"` exists for queue ordering (semantics unverified).
- Gotcha: if the input generator throws, TS surfaces only `Claude Code process aborted by user`. Debug the generator first.

Resume across restarts (sessions):
- Capture `session_id` from the `init` or `result` message. Later: `query({ prompt, options: { resume: sessionId } })`. `continue: true` resumes the most recent session in `cwd`. `forkSession: true` with `resume` branches into a new id.
- Sessions are JSONL files under `~/.claude/projects/<encoded-cwd>/` (or `$CLAUDE_CONFIG_DIR/projects/`). They are local to the machine; for multi-host use a `sessionStore` adapter (`SessionStore`) or keep a stable `cwd` + persistent volume. If we pass `persistSession: false` there is nothing to resume.
- Resume restores conversation only, not our graph state. The graph lives in the Y.Doc anyway, so a fresh session with a "current graph" prompt is a valid and often more robust alternative to resume.
- System prompt on a resumed session: it is recorded on the first request and reused until compaction. A new `append`/custom prompt on resume is ignored unless `snapshot: false` (v0.3.257+). To push new instructions mid-session, put them in the next user message.
- Hosting guidance for long-running sessions: pin each session to one process, bound with `maxTurns`, recycle subprocesses (memory grows with session length), and there is no built-in wall-clock timeout. Use `startup()` / `prewarm()` (TS) to pre-spawn subprocesses (details unverified; see the reference page).

## 5. Permissions

Source: https://code.claude.com/docs/en/agent-sdk/permissions

Evaluation order: hooks, deny rules, ask rules, permission mode, allow rules, `canUseTool`.

- Since we have only our own MCP tools and no built-ins, the simplest safe setup is `tools: []` + `allowedTools: ["mcp__patchwerk__*"]` + `permissionMode: "dontAsk"`. Allowed calls run; everything else is denied; `canUseTool` is never called.
- If we want a human gate for destructive tools (for example `delete_node`), leave the mode at `default`, do not put that tool in `allowedTools`, and implement `canUseTool` to ask the browser. Allowed-listed tools never reach `canUseTool`. Callback shape (from the user-input docs, signature not re-fetched, (unverified)): `async (toolName, input, ctx) => ({ behavior: "allow", updatedInput: input }) | ({ behavior: "deny", message })`.
- `permissionMode: 'bypassPermissions'` requires `allowDangerouslySkipPermissions: true`, and Claude Code refuses to start in it as root/sudo outside a recognized sandbox (relevant in containers). `allowedTools` does not restrict `bypassPermissions` (all tools are approved). We should not need it.
- Omitting `permissionMode` may start in `auto` (model-classified) on newer versions (before v0.3.286 it was `default`). Always set it explicitly.
- `permissionPrompts: 'none'` (v2.1.259+) denies instead of calling the callback (details unverified).
- A TS warning `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` fires if `canUseTool` is set alongside bypass or bare allow rules.

## 6. System prompt

Source: https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts

- Omitted: minimal tool-calling prompt only.
- Custom string: replaces everything; we own identity, tool guidance, safety. Right for Patchwerk (a non-coding agent with different identity and tools).
- `{ type: "preset", preset: "claude_code", append: "..." }`: keeps the Claude Code prompt (coding/filesystem oriented) and adds ours. Wrong fit here, since it talks about files and bash we removed.
- With a custom string, add a line explaining system reminders (the app injects them; treat as app context, not user). CLAUDE.md is not loaded when `settingSources: []`.
- Prompt caching: TS array form `[static, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, perRequest]` splits the cached part from the dynamic part (only on direct Claude API). Good for putting the operator guide in the static part and "current selection" in the dynamic part. Preset form has `excludeDynamicSections: true`.
- Per-turn graph context (selected node, errors): send it in the user message, not the system prompt.

## 7. Cost, usage, models

Source: https://code.claude.com/docs/en/agent-sdk/cost-tracking; model ids from the claude-api skill (cached 2026-10-06).

- The `result` message carries `total_cost_usd` (client-side ESTIMATE, not billing), `usage` (main loop only, includes `cache_read_input_tokens`/`cache_creation_input_tokens`), `modelUsage` (per-model `costUSD`, token counts; includes subagents), `num_turns`, `duration_ms`, `duration_api_ms`.
- Streaming input mode: each turn emits its own `result`. `total_cost_usd` and `modelUsage` are running totals for the whole query, so read the latest rather than summing (`usage` is per-turn). Totals reset on `/clear`, `/reset`, `/new`.
- Per-step `output_tokens` on assistant messages is a placeholder; take output tokens from the result.
- `maxBudgetUsd` caps spend (error subtype `error_max_budget_usd`).
- Model ids (exact strings, no date suffix): `claude-opus-5-5` (current Opus, $4/$20 per MTok, default), `claude-sonnet-5-5` ($2/$10), `claude-haiku-5-5` ($0.10/$0.50), `claude-fable-5-1` ($10/$50), plus older `claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`. All current ones have 1M context except Haiku 4.5.
- Model-specific API facts that pass through the SDK: thinking cannot be disabled on Opus 5.5 / Sonnet 5.5 (omit `thinking`), forced `tool_choice` is rejected (the SDK does not force tools, so it is fine), and Opus 5.5 effort defaults to `medium`. Effort/thinking pass-through options in the SDK (`effort`, `thinking`) exist per the reference but their exact types are (unverified).
- OTEL: set `CLAUDE_CODE_ENABLE_TELEMETRY=1` and `OTEL_*` env for traces/metrics. Prompt text is excluded by default.

## 8. Pitfalls and deployment implications

Sources: https://code.claude.com/docs/en/agent-sdk/hosting, /typescript

1. Subprocess per session. `server/` must be able to exec a native binary (about 100+ MB per platform package, size unverified). Use a glibc or musl-matching image; do not strip optional deps; ensure execute permission survives the image build. The Linux musl/glibc pick is automatic (v0.2.141+).
2. It is a stateful long-lived process: memory grows with session length. Cap with `maxTurns`, idle-timeout and `close()` unused sessions, and recycle. Size hosts as RAM divided by per-session peak RSS.
3. Disk: transcripts under `~/.claude` are written unless `persistSession: false`. In ephemeral containers they vanish on restart. Mount a volume or use `sessionStore`.
4. `env` replaces the environment. Always spread `process.env`.
5. Defaults load filesystem config. On a shared server set `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a per-session empty `cwd`, and per-tenant `CLAUDE_CONFIG_DIR`. Otherwise a `.claude/settings.json` or `CLAUDE.md` in the cwd could change behavior.
6. Single-shot `query()` throws after error results; wrap in try/catch and still read cost from the error result.
7. Keep tool results small. Every `view_node` image stays in context for the rest of the session. Consider `clear`-style context handling or session recycling; compaction happens automatically in Claude Code (`compact_boundary` messages).
8. `allowedTools` is a permission list, not an availability list. Availability is `tools: []` / `disallowedTools`.
9. Under Bun: SDK officially lists Node 18+ and a `bun` executable option; verify `executable` auto-detect picks the right runtime for the CLI wrapper. Unresolved issues around Bun specifics (stdio pipes, abort signals) are (unverified). Test spawn, interrupt, and abort under `bun run`.
10. Bypass mode as root is refused; running our server as root in a container with `bypassPermissions` fails before the first turn. Another reason to use `dontAsk`.
11. The `Task`/subagent tool is called `Task` in `init.tools` for backward compat. Do not rely on it being absent.
12. Cost numbers are estimates. Do not bill from them.
13. Rate limits: wide parallel fan-outs can hit them; our one-agent-per-room model is fine.
14. Terms: the SDK is covered by Anthropic's Commercial Terms; no claude.ai login for end users.

## Sources

- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/agent-sdk/typescript (only the first ~200k chars of 291k read; Options section beyond that and `startup()`/`prewarm()` not read)
- https://code.claude.com/docs/en/agent-sdk/custom-tools
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-sdk/permissions
- https://code.claude.com/docs/en/agent-sdk/hosting
- https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
- https://code.claude.com/docs/en/agent-sdk/cost-tracking
- Not fetched: /agent-sdk/mcp (external MCP servers) and /agent-sdk/user-input (`canUseTool` full signature).
