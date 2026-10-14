import type { Edge } from "@xyflow/react";
import { useAudio } from "../audio";
import { engine, type Snapshot } from "../engine/engine";
import { ExprError, evalExpr, type ExprEnv } from "../engine/expr";
import { getLive } from "../engine/live";
import { COOK_H, COOK_W } from "../engine/render";
import { TEMPLATE } from "../engine/sources";
import { parseShader, type ParsedShader, type ShaderParam } from "../engine/wrap";
import { FAMILIES, type Family } from "../family";
import { inletHandles, OPS, type Par, type ParMode } from "../ops/catalog";
import { isValidConnection, nodeInlets, nodeOutlet, useGraph, type NodeData, type PNode, type ShaderData } from "../store";
import { useSync } from "../sync";
import type { Content, ToolName, ToolResult } from "./protocol";

type Input = Record<string, unknown>;

class ToolError extends Error {}

const VIEW_W = 768;
const VIEW_H = 432;
const VALUE_ERRORS = new Set(["division by zero", "mod by zero", "result is not finite"]);
const READ_ONLY = new Set<ToolName>(["get_graph", "read_shader", "view"]);

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: "text", text }] });
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
const fmt = (value: number): string => String(Number(value.toPrecision(4)));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

export function graphText(): string {
  const { nodes, edges, playing } = useGraph.getState();
  const peers = useSync.getState().peers;
  const people = peers.length
    ? peers.map((peer) => (peer.editing ? `${peer.name} editing ${labelOf(peer.editing)}` : peer.name)).join(", ")
    : "nobody else";
  const labelWidth = Math.max(0, ...nodes.map((node) => node.data.label.length));
  const kindWidth = Math.max(0, ...nodes.map((node) => kindName(node.data).length));
  return [
    `time ${engine.seconds.toFixed(1)}s  ${playing ? "playing" : "paused"} (this tab)  cook ${COOK_W}x${COOK_H}  ${micText()}`,
    `people: ${people}`,
    `nodes (${nodes.length})`,
    ...nodes.map((node) => `  ${node.data.label.padEnd(labelWidth)} ${kindName(node.data).padEnd(kindWidth)} ${nodeSummary(node)}`.trimEnd()),
    `wires (${edges.length})`,
    ...edges.map((edge) => `  ${wireText(edge)}`),
  ].join("\n");
}

export async function runTool(name: ToolName, input: Record<string, unknown>): Promise<ToolResult> {
  const args: Input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  try {
    const result = await dispatch(name, args);
    const warning = READ_ONLY.has(name) ? null : emptyOutWarning();
    return warning ? { ...result, content: [...result.content, { type: "text", text: warning }] } : result;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function dispatch(name: ToolName, args: Input): Promise<ToolResult> {
  switch (name) {
    case "get_graph":
      return ok(graphText());
    case "read_shader":
      return ok(readShader(args));
    case "write_shader":
      return writeShader(args);
    case "set_param":
      return ok(setParamTool(args));
    case "add_node":
      return ok(addNode(args));
    case "connect":
      return connectTool(args);
    case "disconnect":
      return ok(disconnectTool(args));
    case "edit_node":
      return ok(editNode(args));
    case "view":
      return await view(args);
    default:
      return fail(`unknown tool ${String(name)}`);
  }
}

function emptyOutWarning(): string | null {
  const { nodes, edges } = useGraph.getState();
  const empty = nodes.filter((node) => node.data.kind === "out" && !edges.some((edge) => edge.target === node.id && edge.targetHandle === "ch0"));
  if (!empty.length) return null;
  return `! ${empty.map((node) => `${node.data.label}.ch0`).join(", ")} ${empty.length === 1 ? "is" : "are"} empty, so the picture is black; wire a TOP into it`;
}

function readShader(input: Input): string {
  const { id, data } = shaderNode(str(input, "node"));
  const parsed = parseShader(data.draft);
  const lines = data.draft.split("\n");
  const width = String(lines.length).length;
  const inlets = nodeInlets(data);
  return [
    `${data.label} TOP/shader ${statusOf(data)}${data.bypass ? "  BYPASS" : ""}${inlets.length ? `  inlets[${inlets.join(" ")}]` : ""}`,
    ...problemLines(id, data).map((line) => `  ${line}`),
    ...(parsed.feedback ? ["  iChannel3 is this node's previous frame (@feedback)"] : []),
    ...parsed.prev.map((prev) => `  iChannel${prev.channel} is ${prev.label}'s previous frame (@prev)`),
    `source (${plural(lines.length, "line")}):`,
    ...lines.map((line, index) => `${String(index + 1).padStart(width)}  ${line}`),
    data.params.length ? "params:" : "params: none",
    ...data.params.map((param) => `  ${shaderParamText(id, param)}${param.kind === "menu" ? ` (${param.options.join("|")})` : ""}`),
  ].join("\n");
}

function writeShader(input: Input): ToolResult {
  const { id, data } = shaderNode(str(input, "node"));
  const code = str(input, "code");
  refuseIfEditing(id, data.label);
  const parsed = parseShader(code);
  const dropped = useGraph
    .getState()
    .edges.filter((edge) => edge.target === id && /^ch[0-3]$/.test(edge.targetHandle ?? "") && !parsed.channels.includes(channelOf(edge)));
  const report = dropped.map((edge) => `- wire ${wireText(edge)} (${dropReason(parsed, channelOf(edge))})`);
  useGraph.getState().updateDraft(id, code);
  removeEdges(dropped);
  const result = engine.compileNow(id);
  const text = [compileText(id, result), ...report].join("\n");
  return result.status === "live" ? ok(text) : fail(text);
}

function setParamTool(input: Input): string {
  const node = findNode(str(input, "node"));
  const name = str(input, "name").trim();
  const value = input.value;
  const { id, data } = node;
  const where = `${data.label}.${name}`;
  if (data.kind === "shader") {
    const param = data.params.find((item) => item.name === name);
    if (!param) throw noPar(name, data.label, data.params.map((item) => item.name));
    const write = useGraph.getState().setParam;
    if (param.kind === "float") {
      return setNumber(where, { ...param, mode: param.mode ?? "constant", expr: param.expr ?? "" }, value, (patch) => write(id, name, patch));
    }
    if (param.kind === "menu") {
      const pick = menuPick(name, param.options, value);
      write(id, name, { menu: pick });
      return `~ ${where} ${param.value} → ${pick}`;
    }
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new ToolError(`${where} is a color; pass "#rrggbb"`);
    const rgb: [number, number, number] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16) / 255) as [number, number, number];
    write(id, name, rgb);
    return `~ ${where} ${hex(param.value)} → ${value.toLowerCase()}`;
  }
  if (data.kind !== "op") throw new ToolError(`${data.label} (${kindName(data)}) has no parameters`);
  const par = data.pars.find((item) => item.name === name);
  if (!par) throw noPar(name, data.label, data.pars.map((item) => item.name));
  const write = useGraph.getState().setOpPar;
  if (par.kind === "number") {
    return setNumber(where, par, value, (patch) => write(id, name, patch));
  }
  if (par.kind === "menu") {
    const pick = menuPick(name, par.options, value);
    write(id, name, pick);
    return `~ ${where} ${par.value} → ${pick}`;
  }
  if (typeof value !== "string") throw new ToolError(`${where} is a name; pass a string`);
  if (par.ref) checkRef(where, par.ref, value);
  write(id, name, { text: value });
  return `~ ${where} ${par.value || '""'} → ${value || '""'}`;
}

function setNumber(
  where: string,
  par: { mode: ParMode; value: number; expr: string; min: number; max: number; step?: number },
  value: unknown,
  write: (patch: number | { mode: ParMode; expr: string }) => void,
): string {
  const before = par.mode === "expression" && par.expr.trim() ? `expr(${par.expr})` : fmt(par.value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const next = par.step === 1 ? Math.round(value) : value;
    write(next);
    const outside = next < par.min || next > par.max ? ` (outside slider range [${fmt(par.min)}..${fmt(par.max)}])` : "";
    return `~ ${where} ${before} → ${fmt(next)}${outside}`;
  }
  if (value && typeof value === "object" && "expr" in value && typeof value.expr === "string" && value.expr.trim()) {
    const expr = value.expr.trim();
    validateExpr(expr);
    write({ mode: "expression", expr });
    return `~ ${where} → expr(${expr})`;
  }
  throw new ToolError(`${where} is a number; pass a number or { "expr": "..." }`);
}

function validateExpr(expr: string): void {
  const nodes = useGraph.getState().nodes;
  const chops = nodes.filter((node) => node.data.kind === "op" && node.data.family === "CHOP").map((node) => node.data.label);
  const known = chops.length ? `CHOPs are ${chops.join(", ")}` : "there are no CHOPs; add one with add_node";
  const env: ExprEnv = {
    seconds: 1.234,
    op: (name, channel) => {
      const found = nodes.find((node) => node.data.label === name);
      if (!found) throw new ExprError(`op('${name}') is missing; ${known}`);
      if (found.data.kind !== "op" || found.data.family !== "CHOP") throw new ExprError(`op('${name}') is a ${kindName(found.data)}, not a CHOP; ${known}`);
      if (channel !== "chan1") throw new ExprError(`['${channel}'] is not a channel; chan1 is the only one`);
      return 0;
    },
  };
  try {
    evalExpr(expr, env);
  } catch (error) {
    if (!(error instanceof ExprError)) throw error;
    if (!VALUE_ERRORS.has(error.message)) throw new ToolError(`expression error: ${error.message}`);
  }
}

function checkRef(where: string, ref: { family: Family; type?: string }, value: string): void {
  const candidates = useGraph
    .getState()
    .nodes.filter((node) => node.data.family === ref.family && (!ref.type || (node.data.kind === "op" && node.data.type === ref.type)))
    .map((node) => node.data.label);
  if (candidates.includes(value)) return;
  const there = candidates.length
    ? `there ${candidates.length === 1 ? "is" : "are"} ${candidates.join(", ")}`
    : "there is none yet; add one with add_node";
  throw new ToolError(`${where} must name a ${ref.type ? `${ref.family}/${ref.type}` : ref.family}; ${there}`);
}

function addNode(input: Input): string {
  const family = str(input, "family").trim() as Family;
  if (!FAMILIES.includes(family)) throw new ToolError(`family must be one of ${FAMILIES.join(", ")}`);
  const type = str(input, "type").trim();
  const types = typesOf(family);
  if (!types.includes(type)) throw new ToolError(`no ${family} type "${type}"; ${family} has ${types.join(", ")}`);
  const label = optStr(input, "label")?.trim();
  const code = optStr(input, "code");
  const shader = family === "TOP" && type === "shader";
  if (code !== undefined && !shader) throw new ToolError("code is only for a shader TOP");
  const afterRef = optStr(input, "after");
  const after = afterRef === undefined ? undefined : findNode(afterRef);
  if (after) {
    if (after.data.family !== family) throw new ToolError(`after must be a ${family} node; ${after.data.label} is ${kindName(after.data)}`);
    if (!nodeOutlet(after.data)) throw new ToolError(`${after.data.label} has no outlet, so nothing can follow it; leave out after`);
    const kind = family === "TOP" && (type === "shader" || type === "audio" || type === "webcam" || type === "out") ? type : "op";
    const inlets = inletHandles({ kind, family, type, channels: parseShader(code ?? TEMPLATE).channels });
    if (!inlets.length) {
      throw new ToolError(
        shader
          ? `the code reads no iChannel, so there is no inlet to splice ${after.data.label} into; read iChannel0 in the code or leave out after`
          : `${family}/${type} has no inlet, so it cannot follow ${after.data.label}; leave out after`,
      );
    }
  }
  const downstream = after ? useGraph.getState().edges.filter((edge) => edge.source === after.id) : [];
  const id = useGraph.getState().addOp(family, type, { after: after?.id, label, select: false });
  const name = labelOf(id);
  const lines = [`+ node ${name} ${family}/${type}`];
  if (shader) {
    if (code !== undefined) useGraph.getState().updateDraft(id, code);
    lines.push(compileText(id, engine.compileNow(id)));
  }
  const created = nodeById(id);
  if (created.data.kind === "op") {
    const refs = created.data.pars.filter((par) => par.kind === "text" && par.ref);
    if (refs.length) lines.push(`${name}: ${refs.map((par) => `${par.name}=${par.value || '""'}`).join(" ")} (guessed)`);
  }
  if (!after) return lines.join("\n");
  const inlet = nodeInlets(created.data)[0] ?? "";
  removeEdges(downstream);
  const fed = useGraph.getState().edges.some((edge) => edge.source === after.id && edge.target === id && edge.targetHandle === inlet);
  const why = fed ? null : refusal(after, created, inlet);
  if (why) lines.push(`! ${after.data.label}.out → ${name}.${inlet} refused: ${why}`);
  else {
    if (!fed) wire(after.id, id, inlet);
    lines.push(`+ wire ${after.data.label}.out → ${name}.${inlet}`);
  }
  for (const edge of downstream) {
    const handle = edge.targetHandle ?? "";
    const target = nodeById(edge.target);
    const refused = refusal(nodeById(id), target, handle);
    if (refused) {
      wire(edge.source, edge.target, handle);
      lines.push(`! kept ${wireText(edge)}: ${refused}`);
      continue;
    }
    wire(id, edge.target, handle);
    lines.push(`~ wire ${name}.out → ${target.data.label}.${handle} (was ${after.data.label}.out)`);
  }
  return lines.join("\n");
}

function connectTool(input: Input): ToolResult {
  const source = findNode(str(input, "source"));
  const target = findNode(str(input, "target"));
  const inlet = str(input, "inlet").trim();
  const text = `${source.data.label}.out → ${target.data.label}.${inlet}`;
  const exists = useGraph.getState().edges.some((edge) => edge.source === source.id && edge.target === target.id && edge.targetHandle === inlet);
  if (exists) return ok(`wire ${text} already exists`);
  const why = refusal(source, target, inlet);
  if (why) return fail(`refused: ${why}`);
  wire(source.id, target.id, inlet);
  return ok(`+ wire ${text}`);
}

function disconnectTool(input: Input): string {
  const target = findNode(str(input, "target"));
  const inlet = str(input, "inlet").trim();
  const edge = useGraph.getState().edges.find((item) => item.target === target.id && item.targetHandle === inlet);
  if (!edge) return `nothing feeds ${target.data.label}.${inlet}`;
  const text = wireText(edge);
  removeEdges([edge]);
  return `- wire ${text}`;
}

function editNode(input: Input): string {
  const node = findNode(str(input, "node"));
  const label = optStr(input, "label");
  const bypass = optBool(input, "bypass");
  const remove = optBool(input, "delete") ?? false;
  if (label === undefined && bypass === undefined && !remove) throw new ToolError("pass label, bypass or delete");
  if (remove) {
    if (label !== undefined || bypass !== undefined) throw new ToolError("delete alone; do not combine it with label or bypass");
    return deleteNode(node);
  }
  const lines: string[] = [];
  if (label !== undefined) lines.push(...renameNode(node, label.trim()));
  if (bypass !== undefined) {
    useGraph.getState().setBypass(node.id, bypass);
    lines.push(`~ ${labelOf(node.id)} bypass ${bypass ? "on" : "off"}`);
  }
  return lines.join("\n");
}

function renameNode(node: PNode, want: string): string[] {
  const old = node.data.label;
  const refs = references(old, node.id);
  useGraph.getState().rename(node.id, want);
  const next = labelOf(node.id);
  if (next === old) return [`${old} is already named ${old}`];
  const taken = next === want ? "" : `${want} is taken; `;
  return [
    ...(refs.prev.length ? [`! ${refs.prev.join(", ")} still ${refs.prev.length === 1 ? "names" : "name"} ${old}; fix the code with write_shader`] : []),
    `~ ${old} renamed to ${next} (${taken}${plural(refs.followed.length, "reference")} followed)`,
  ];
}

function deleteNode(node: PNode): string {
  const { id, data } = node;
  if (data.kind === "out" || id === "out") throw new ToolError(`${data.label} is the final picture and cannot be deleted; rewire its ch0 instead`);
  refuseIfEditing(id, data.label);
  const refs = references(data.label, id);
  const named = [...refs.followed, ...refs.prev];
  const touching = useGraph.getState().edges.filter((edge) => edge.source === id || edge.target === id);
  removeEdges(touching);
  useGraph.getState().onNodesChange([{ type: "remove", id }]);
  return [
    ...(named.length ? [`! ${named.join(", ")} still ${named.length === 1 ? "names" : "name"} ${data.label}; point ${named.length === 1 ? "it" : "them"} elsewhere`] : []),
    `- node ${data.label} (${plural(touching.length, "wire")} removed)`,
  ].join("\n");
}

async function view(input: Input): Promise<ToolResult> {
  const node = findNode(optStr(input, "node") ?? "out");
  const frames = Math.min(4, Math.max(1, Math.round(optNum(input, "frames") ?? 1)));
  const interval = Math.round(Math.min(2000, Math.max(100, optNum(input, "interval_ms") ?? 400)));
  const shots: Snapshot[] = [];
  for (let index = 0; index < frames; index++) {
    if (index > 0) await sleep(interval);
    shots.push(await engine.snapshot(node.id, VIEW_W, VIEW_H));
  }
  const label = labelOf(node.id);
  const paused = useGraph.getState().playing ? "" : "  paused in this tab: frames are identical; ask a human to press play";
  if (node.data.family === "CHOP") {
    const samples = shots.flatMap((shot) => (shot.kind === "chop" && shot.now !== null ? [shot.now] : []));
    const last = samples.at(-1);
    if (last === undefined) return ok(`${label} has not cooked a value yet${paused}`);
    const span = (shots.at(-1)?.time ?? 0) - (shots[0]?.time ?? 0);
    return ok(
      `${label} over ${fmt(span)}s (${frames} ${frames === 1 ? "frame" : "frames"} x ${interval}ms): ${samples.map(fmt).join(" ")}   min ${fmt(Math.min(...samples))} max ${fmt(Math.max(...samples))} now ${fmt(last)}${paused}`,
    );
  }
  const content = shots.flatMap((shot): Content[] => {
    if (shot.kind !== "image") return [];
    const stats = shot.stats
      ? `mean luma ${fmt(shot.stats.mean)}  black ${Math.round(shot.stats.black * 100)}%  nan ${shot.stats.nan}`
      : "no stats for this node";
    return [
      { type: "text", text: `${label} @ ${shot.time.toFixed(1)}s  ${VIEW_W}x${VIEW_H}  ${stats}${paused}` },
      { type: "image", data: shot.png, mimeType: "image/png" },
    ];
  });
  return { content };
}

function refusal(source: PNode, target: PNode, inlet: string): string | null {
  const from = source.data;
  const to = target.data;
  if (source.id === target.id) return `${from.label} cannot feed itself; use // @feedback in a shader for a loop`;
  if (!nodeOutlet(from)) return `${from.label} has no outlet; ${from.family === "MAT" ? "a MAT is used through geo.mat" : "a COMP is used through geo.cam or render.geo"}`;
  if (from.family !== to.family) return `families differ (${from.family} → ${to.family}); ${crossHint(from.family, to.family)}`;
  const inlets = nodeInlets(to);
  if (!inlets.includes(inlet)) return `${to.label} has no inlet ${inlet} (${inletHint(to, inlets)})`;
  const { edges } = useGraph.getState();
  const holder = edges.find((edge) => edge.target === target.id && edge.targetHandle === inlet && edge.source !== source.id);
  if (holder) return `${to.label}.${inlet} is already fed by ${labelOf(holder.source)}; disconnect it first`;
  if (reaches(target.id, source.id, edges)) return "would form a cycle";
  if (!isValidConnection({ source: source.id, sourceHandle: "out", target: target.id, targetHandle: inlet })) return "the wire is not valid";
  return null;
}

function crossHint(from: Family, to: Family): string {
  if (from === "POP" && to === "TOP") return "a POP reaches a TOP through geo → render";
  if (from === "CHOP") return "a CHOP reaches other families through expressions like op('label')['chan1'] in a number parameter";
  return "cross-family links are parameters, not wires";
}

function inletHint(data: NodeData, inlets: string[]): string {
  if (data.kind === "shader") {
    return data.channels.length ? `its code reads ${data.channels.map((channel) => `iChannel${channel}`).join(", ")} only` : "its code reads no iChannel";
  }
  return inlets.length ? `it has ${inlets.join(", ")}` : "it has no inlets";
}

function reaches(from: string, to: string, edges: Edge[]): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    if (id === to) return true;
    seen.add(id);
    for (const edge of edges) if (edge.source === id) stack.push(edge.target);
  }
  return false;
}

function wire(source: string, target: string, inlet: string): void {
  useGraph.getState().onConnect({ source, sourceHandle: "out", target, targetHandle: inlet });
}

function removeEdges(edges: Edge[]): void {
  if (edges.length) useGraph.getState().onEdgesChange(edges.map((edge) => ({ type: "remove", id: edge.id })));
}

function references(label: string, except: string): { followed: string[]; prev: string[] } {
  const call = new RegExp(`op\\(\\s*(['"])${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1\\s*\\)`);
  const followed: string[] = [];
  const prev: string[] = [];
  for (const node of useGraph.getState().nodes) {
    if (node.id === except) continue;
    const data = node.data;
    if (data.kind === "op") {
      for (const par of data.pars) {
        if ((par.kind === "number" && call.test(par.expr)) || (par.kind === "text" && par.ref && par.value === label)) followed.push(`${data.label}.${par.name}`);
      }
    }
    if (data.kind === "shader") {
      for (const param of data.params) if (param.kind === "float" && param.expr && call.test(param.expr)) followed.push(`${data.label}.${param.name}`);
      for (const item of parseShader(data.draft).prev) if (item.label === label) prev.push(`${data.label} // @prev iChannel${item.channel}`);
    }
  }
  return { followed, prev };
}

function compileText(id: string, result: { status: "live" | "error"; error: string | null }): string {
  if (result.status === "live") return "live — compiled and passed the test frame";
  const problems = (result.error ?? "compile failed")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const node = useGraph.getState().nodes.find((item) => item.id === id);
  const shown = node?.data.kind === "shader" && node.data.committed !== null;
  return [
    `error — ${plural(problems.length, "problem")}`,
    ...problems.map((line) => `  ${line}`),
    shown ? "draft saved; previous program still showing" : "draft saved; nothing has compiled on this node yet, so it shows black",
  ].join("\n");
}

function dropReason(parsed: ParsedShader, channel: number): string {
  if (parsed.feedback && channel === 3) return "iChannel3 is now @feedback";
  const prev = parsed.prev.find((item) => item.channel === channel);
  if (prev) return `iChannel${channel} is now @prev ${prev.label}`;
  return `code no longer reads iChannel${channel}`;
}

function channelOf(edge: Edge): number {
  return Number((edge.targetHandle ?? "").slice(2));
}

function nodeSummary(node: PNode): string {
  const data = node.data;
  const parts = [statusOf(data).padEnd(6)];
  if (data.bypass) parts.push("BYPASS");
  if (data.kind === "shader" || data.kind === "out") {
    const inlets = nodeInlets(data);
    if (inlets.length) parts.push(`inlets[${inlets.join(" ")}]`);
  }
  const pars =
    data.kind === "shader"
      ? data.params.map((param) => shaderParamText(node.id, param))
      : data.kind === "op"
        ? data.pars.map((par) => opParText(node.id, par))
        : [];
  if (pars.length) parts.push(pars.join(" "));
  const problems = problemLines(node.id, data);
  if (problems.length) parts.push(problems.join("; "));
  return parts.join("  ");
}

function problemLines(id: string, data: NodeData): string[] {
  if (data.kind === "op") return data.status === "error" && data.error ? data.error.split("\n").filter(Boolean) : [];
  if (data.kind !== "shader") return [];
  const lines: string[] = [];
  if (data.status === "error") {
    lines.push(...(data.error ?? "compile failed").split("\n").filter(Boolean));
    lines.push(data.committed !== null ? "(last good program still shows)" : "(nothing has compiled yet)");
  }
  for (const param of data.params) {
    const error = param.kind === "float" ? getLive(id, param.name)?.error : null;
    if (error) lines.push(`${param.name}: ${error}`);
  }
  return lines;
}

function shaderParamText(id: string, param: ShaderParam): string {
  if (param.kind === "color") return `${param.name}=${hex(param.value)}`;
  if (param.kind === "menu") return `${param.name}=${param.value}`;
  return `${param.name}=${numberText(id, param.name, param.mode, param.value, param.expr)} [${fmt(param.min)}..${fmt(param.max)}]`;
}

function opParText(id: string, par: Par): string {
  if (par.kind === "number") return `${par.name}=${numberText(id, par.name, par.mode, par.value, par.expr)}`;
  return `${par.name}=${par.value || '""'}`;
}

function numberText(id: string, name: string, mode: ParMode | undefined, value: number, expr: string | undefined): string {
  if (mode !== "expression" || !expr?.trim()) return fmt(value);
  const live = getLive(id, name);
  return `expr(${expr})${live && !live.error ? `=${fmt(live.cooked)}` : ""}`;
}

function statusOf(data: NodeData): string {
  if (data.kind !== "shader" && data.kind !== "op") return "live";
  return data.status === "error" ? "ERROR" : data.status;
}

function micText(): string {
  const { source, status } = useAudio.getState();
  if (status === "live" && source === "mic") return "mic on";
  if (status === "live" && source === "file") return "audio file playing in this tab";
  return "mic off (synthetic spectrum until a human enables it)";
}

function hex(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function kindName(data: NodeData): string {
  return `${data.family}/${data.kind === "op" ? data.type : data.kind}`;
}

function typesOf(family: Family): string[] {
  const ops = OPS.filter((spec) => spec.family === family).map((spec) => spec.type);
  return family === "TOP" ? [...ops, "shader", "audio", "webcam", "out"] : ops;
}

function wireText(edge: Edge): string {
  return `${labelOf(edge.source)}.out → ${labelOf(edge.target)}.${edge.targetHandle ?? ""}`;
}

function labelOf(id: string): string {
  return useGraph.getState().nodes.find((node) => node.id === id)?.data.label ?? id;
}

function nodeById(id: string): PNode {
  const node = useGraph.getState().nodes.find((item) => item.id === id);
  if (!node) throw new ToolError(`node ${id} is gone`);
  return node;
}

function findNode(ref: string): PNode {
  const want = ref.trim();
  const { nodes } = useGraph.getState();
  const found = nodes.find((node) => node.data.label === want) ?? nodes.find((node) => node.id === want);
  if (found) return found;
  throw new ToolError(`no node "${want}"; the nodes are ${nodes.map((node) => node.data.label).join(", ") || "none"}`);
}

function shaderNode(ref: string): { id: string; data: ShaderData } {
  const node = findNode(ref);
  if (node.data.kind !== "shader") throw new ToolError(`${node.data.label} is ${kindName(node.data)}, not a shader TOP; only shader TOPs have code`);
  return { id: node.id, data: node.data };
}

function refuseIfEditing(id: string, label: string): void {
  const peer = useSync.getState().peers.find((item) => item.editing === id);
  if (peer) throw new ToolError(`${peer.name} is editing ${label} right now; ask them or pick another node`);
}

function noPar(name: string, label: string, names: string[]): ToolError {
  return new ToolError(`no par "${name}" on ${label}; it has ${names.length ? names.join(", ") : "none"}`);
}

function menuPick(name: string, options: string[], value: unknown): string {
  if (typeof value === "string" && options.includes(value)) return value;
  throw new ToolError(`menu ${name} accepts ${options.join(", ")}`);
}

function str(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new ToolError(`${key} is required and must be a non-empty string`);
  return value;
}

function optStr(input: Input, key: string): string | undefined {
  return input[key] == null ? undefined : str(input, key);
}

function optBool(input: Input, key: string): boolean | undefined {
  const value = input[key];
  if (value == null) return undefined;
  if (typeof value !== "boolean") throw new ToolError(`${key} must be true or false`);
  return value;
}

function optNum(input: Input, key: string): number | undefined {
  const value = input[key];
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolError(`${key} must be a number`);
  return value;
}
