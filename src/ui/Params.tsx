import { Leva, useControls } from "leva";
import { useEffect, useState } from "react";
import { useGraph, type ShaderData } from "../store";
import { ParRow } from "./ParRow";

export function Params() {
  const node = useGraph((state) => state.nodes.find((item) => item.selected));
  const rename = useGraph((state) => state.rename);
  const shader = node?.data.kind === "shader" ? node.data : null;
  const op = node?.data.kind === "op" ? node.data : null;
  const [label, setLabel] = useState(node?.data.label ?? "");
  useEffect(() => setLabel(node?.data.label ?? ""), [node?.id, node?.data.label]);

  return (
    <section className="params">
      <header>
        <span>parameters</span>
        {node ? (
          <input
            className="rename"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={() => rename(node.id, label)}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <b>none</b>
        )}
        {op && <em>{op.type}</em>}
      </header>
      {shader ? (
        <>
          <Leva fill flat titleBar={false} />
          <ShaderControls key={`${shader.label}:${shader.params.map((param) => param.name).join(",")}`} id={node?.id ?? ""} data={shader} />
        </>
      ) : op ? (
        op.pars.length ? (
          op.pars.map((par) => <ParRow key={par.name} id={node?.id ?? ""} par={par} />)
        ) : (
          <p className="empty">No parameters. This operator copies its input.</p>
        )
      ) : (
        <p className="empty">{node ? "This operator has no parameters." : "Select an operator."}</p>
      )}
    </section>
  );
}

function ShaderControls({ id, data }: { id: string; data: ShaderData }) {
  const setParam = useGraph((state) => state.setParam);
  const [, set] = useControls(
    () => {
      const schema: Record<string, object> = {};
      for (const param of data.params) {
        if (param.kind === "float") {
          schema[param.name] = {
            value: param.value,
            min: param.min,
            max: param.max,
            step: Math.max((param.max - param.min) / 200, 0.001),
            label: param.label,
            onChange: (value: number, _path: string, context: { fromPanel: boolean }) => {
              if (context.fromPanel) setParam(id, param.name, value);
            },
          };
        } else {
          const [r, g, b] = param.value;
          schema[param.name] = {
            value: rgbHex(r ?? 1, g ?? 1, b ?? 1),
            label: param.label,
            onChange: (value: unknown, _path: string, context: { fromPanel: boolean }) => {
              if (context.fromPanel) setParam(id, param.name, rgbOf(value));
            },
          };
        }
      }
      return schema as never;
    },
    [id],
  );

  useEffect(() => {
    const values: Record<string, unknown> = {};
    for (const param of data.params) {
      values[param.name] = param.kind === "float" ? param.value : rgbHex(...param.value);
    }
    set(values as never);
  }, [data.params, set]);

  if (data.params.length === 0) return <p className="empty">Annotate a uniform with @range or @color.</p>;
  return null;
}

function rgbHex(r: number, g: number, b: number): string {
  const byte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function rgbOf(value: unknown): [number, number, number] {
  if (typeof value === "string") {
    const hex = value.replace("#", "");
    return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
  }
  if (value && typeof value === "object" && "r" in value && "g" in value && "b" in value) {
    const color = value as { r: number; g: number; b: number };
    const scale = color.r > 1 || color.g > 1 || color.b > 1 ? 255 : 1;
    return [color.r / scale, color.g / scale, color.b / scale];
  }
  return [1, 1, 1];
}
