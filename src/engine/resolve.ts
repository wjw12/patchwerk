import { getLive, setLive } from "./live";
import { ExprError, evalExpr, type ExprEnv } from "./expr";
import type { Par } from "../ops/catalog";

export interface Resolved {
  num: Record<string, number>;
  menu: Record<string, string>;
  text: Record<string, string>;
  errors: { name: string; error: string }[];
}

/** Last good number is kept when an expression fails, same rule as a shader that fails to compile. */
export function resolvePars(id: string, pars: Par[], env: ExprEnv): Resolved {
  const num: Record<string, number> = {};
  const menu: Record<string, string> = {};
  const text: Record<string, string> = {};
  const errors: { name: string; error: string }[] = [];
  for (const par of pars) {
    if (par.kind === "menu") {
      menu[par.name] = par.value;
      continue;
    }
    if (par.kind === "text") {
      text[par.name] = par.value;
      continue;
    }
    if (par.mode !== "expression" || par.expr.trim() === "") {
      num[par.name] = par.value;
      setLive(id, par.name, par.value, null);
      continue;
    }
    try {
      const cooked = evalExpr(par.expr, env);
      num[par.name] = cooked;
      setLive(id, par.name, cooked, null);
    } catch (error) {
      const message = error instanceof ExprError || error instanceof Error ? error.message : "expression failed";
      errors.push({ name: par.name, error: message });
      const cooked = getLive(id, par.name)?.cooked ?? par.value;
      num[par.name] = cooked;
      setLive(id, par.name, cooked, message);
    }
  }
  return { num, menu, text, errors };
}
