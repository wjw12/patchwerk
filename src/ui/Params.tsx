import { useEffect, useState } from "react";
import { shaderNumberPar } from "../engine/wrap";
import { DESCRIBE } from "../ops/catalog";
import { useGraph, type OpData, type ShaderData } from "../store";
import { groupPars, parLabel } from "./par-groups";
import { ColorRow, ParRow, VectorRow, type ParSetter } from "./ParRow";

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
      {op && DESCRIBE[`${op.family}:${op.type}`] && <p className="par-help">{DESCRIBE[`${op.family}:${op.type}`]}</p>}
      {shader ? (
        <ShaderControls id={node?.id ?? ""} data={shader} />
      ) : op ? (
        op.pars.length ? (
          <OpControls id={node?.id ?? ""} data={op} />
        ) : (
          <p className="empty">No parameters. This operator copies its input.</p>
        )
      ) : (
        <p className="empty">{node ? "This operator has no parameters." : "Select an operator."}</p>
      )}
    </section>
  );
}

function OpControls({ id, data }: { id: string; data: OpData }) {
  return (
    <>
      {groupPars(data.pars).map((item) =>
        item.kind === "vector" ? (
          <VectorRow key={item.pars[0]?.name} id={id} label={item.label} pars={item.pars} color={item.color} />
        ) : (
          <ParRow key={item.par.name} id={id} par={item.par} label={parLabel(item.par.name, data.type)} />
        ),
      )}
    </>
  );
}

function ShaderControls({ id, data }: { id: string; data: ShaderData }) {
  const setParam = useGraph((state) => state.setParam);
  if (data.params.length === 0) return <p className="empty">Annotate a uniform with @range or @color.</p>;
  const set: ParSetter = (name, patch) => {
    if (typeof patch === "number" || (typeof patch === "object" && patch !== null)) setParam(id, name, patch);
  };
  return (
    <>
      {data.params.map((param) =>
        param.kind === "float" ? (
          <ParRow key={param.name} id={id} par={shaderNumberPar(param)} label={param.label} set={set} />
        ) : param.kind === "menu" ? (
          <ParRow key={param.name} id={id} par={{ kind: "menu", name: param.name, value: param.value, options: param.options }} label={param.label} set={set} />
        ) : (
          <ColorRow key={param.name} label={param.label} value={param.value} onChange={(rgb) => setParam(id, param.name, rgb)} />
        ),
      )}
    </>
  );
}
