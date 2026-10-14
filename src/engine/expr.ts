// CPU expressions. Enough for the electron-cloud chain:
//   absTime.seconds * 0.08
//   op('e_amp')['chan1']
//   + - * / and parentheses
// Not Python, not GLSL, not eval().

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

export interface ExprEnv {
  seconds: number;
  /** `op(name)[channel]`. Throw ExprError when the op or channel is missing. */
  op(name: string, channel: string): number;
}

export function evalExpr(source: string, env: ExprEnv): number {
  const parser = new Parser(source, env);
  const value = parser.parseExpr();
  parser.skip();
  if (!parser.eof()) throw new ExprError(`unexpected "${parser.rest()}"`);
  if (!Number.isFinite(value)) throw new ExprError("result is not finite");
  return value;
}

class Parser {
  private i = 0;

  constructor(
    private readonly src: string,
    private readonly env: ExprEnv,
  ) {}

  eof(): boolean {
    return this.i >= this.src.length;
  }

  rest(): string {
    return this.src.slice(this.i).trim();
  }

  skip(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i] ?? "")) this.i += 1;
  }

  parseExpr(): number {
    let value = this.parseTerm();
    for (;;) {
      this.skip();
      const op = this.src[this.i];
      if (op !== "+" && op !== "-") break;
      this.i += 1;
      const rhs = this.parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    for (;;) {
      this.skip();
      const op = this.src[this.i];
      if (op !== "*" && op !== "/") break;
      this.i += 1;
      const rhs = this.parseFactor();
      if (op === "/" && rhs === 0) throw new ExprError("division by zero");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  private parseFactor(): number {
    this.skip();
    if (this.src[this.i] === "-") {
      this.i += 1;
      return -this.parseFactor();
    }
    if (this.src[this.i] === "+") {
      this.i += 1;
      return this.parseFactor();
    }
    if (this.src[this.i] === "(") {
      this.i += 1;
      const value = this.parseExpr();
      this.skip();
      if (this.src[this.i] !== ")") throw new ExprError("missing ')'");
      this.i += 1;
      return value;
    }
    if (this.looksLikeNumber()) return this.number();
    const ident = this.ident();
    if (ident === "absTime") return this.absTime();
    if (ident === "op") return this.lookup();
    throw new ExprError(`unknown name "${ident || this.src[this.i] || "end"}"`);
  }

  private absTime(): number {
    this.skip();
    if (this.src[this.i] !== ".") throw new ExprError("expected absTime.seconds");
    this.i += 1;
    this.skip();
    const field = this.ident();
    if (field !== "seconds") throw new ExprError(`absTime.${field || "?"} is not in this subset (seconds only)`);
    return this.env.seconds;
  }

  private lookup(): number {
    this.skip();
    if (this.src[this.i] !== "(") throw new ExprError("expected op('name')");
    this.i += 1;
    this.skip();
    const name = this.string();
    this.skip();
    if (this.src[this.i] !== ")") throw new ExprError("expected ')' after op name");
    this.i += 1;
    this.skip();
    if (this.src[this.i] !== "[") throw new ExprError("expected ['chan1']");
    this.i += 1;
    this.skip();
    const channel = this.string();
    this.skip();
    if (this.src[this.i] !== "]") throw new ExprError("expected ']'");
    this.i += 1;
    if (!name) throw new ExprError("op('') has an empty name");
    return this.env.op(name, channel);
  }

  private looksLikeNumber(): boolean {
    const c = this.src[this.i] ?? "";
    if (c >= "0" && c <= "9") return true;
    return c === "." && (this.src[this.i + 1] ?? "") >= "0" && (this.src[this.i + 1] ?? "") <= "9";
  }

  private number(): number {
    const start = this.i;
    while (this.i < this.src.length && /[0-9.eE+-]/.test(this.src[this.i] ?? "")) {
      // Stop a binary + / - that isn't an exponent sign.
      if ((this.src[this.i] === "+" || this.src[this.i] === "-") && this.i > start) {
        const prev = this.src[this.i - 1];
        if (prev !== "e" && prev !== "E") break;
      }
      this.i += 1;
    }
    const text = this.src.slice(start, this.i);
    const value = Number(text);
    if (!Number.isFinite(value)) throw new ExprError(`bad number "${text}"`);
    return value;
  }

  private ident(): string {
    this.skip();
    const start = this.i;
    if (!/[A-Za-z_]/.test(this.src[this.i] ?? "")) return "";
    this.i += 1;
    while (/[A-Za-z0-9_]/.test(this.src[this.i] ?? "")) this.i += 1;
    return this.src.slice(start, this.i);
  }

  private string(): string {
    const q = this.src[this.i];
    if (q !== "'" && q !== '"') throw new ExprError("expected a quoted string");
    this.i += 1;
    const start = this.i;
    while (this.i < this.src.length && this.src[this.i] !== q) this.i += 1;
    if (this.src[this.i] !== q) throw new ExprError("unterminated string");
    const text = this.src.slice(start, this.i);
    this.i += 1;
    return text;
  }
}
