// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";

/** Feature parameter values: a literal number or an expression string like `width * 2 + 10`. */
export type ParameterValue = number | string;

/** Trigonometric functions take degrees, matching the app's angle convention. */
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
    abs: Math.abs,
    sqrt: Math.sqrt,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    min: Math.min,
    max: Math.max,
    sin: (x) => Math.sin((x * Math.PI) / 180),
    cos: (x) => Math.cos((x * Math.PI) / 180),
    tan: (x) => Math.tan((x * Math.PI) / 180),
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Constant names may not be shadowed by variables — the same expression would
 * otherwise evaluate differently depending on whether a same-named variable exists. */
export function isConstantName(name: string): boolean {
    return name in CONSTANTS;
}

/**
 * Safe arithmetic expression evaluator (no `eval`): `+ - * / %`, parentheses, unary
 * minus, the functions above, `pi`/`e`, and identifiers resolved from `scope`.
 */
export function evaluateExpression(source: string, scope: ReadonlyMap<string, number>): Result<number> {
    const parser = new Parser(source, scope);
    const value = parser.parseExpression();
    if (!value.isOk) return value;
    parser.skipSpaces();
    if (!parser.atEnd()) return Result.err(`Unexpected character: ${parser.current()}`);
    if (!Number.isFinite(value.value)) return Result.err("Expression result is not a finite number");
    return value;
}

/** Resolves a feature parameter to a concrete number against the variable scope. */
export function resolveNumber(value: ParameterValue, scope: ReadonlyMap<string, number>): Result<number> {
    return typeof value === "number" ? Result.ok(value) : evaluateExpression(value, scope);
}

class Parser {
    private pos = 0;

    constructor(
        private readonly source: string,
        private readonly scope: ReadonlyMap<string, number>,
    ) {}

    atEnd(): boolean {
        return this.pos >= this.source.length;
    }

    current(): string {
        return this.source[this.pos];
    }

    skipSpaces(): void {
        while (/\s/.test(this.source[this.pos] ?? "")) this.pos++;
    }

    parseExpression(): Result<number> {
        let left = this.parseTerm();
        if (!left.isOk) return left;
        for (;;) {
            this.skipSpaces();
            const op = this.source[this.pos];
            if (op !== "+" && op !== "-") return left;
            this.pos++;
            const right = this.parseTerm();
            if (!right.isOk) return right;
            left = Result.ok(op === "+" ? left.value + right.value : left.value - right.value);
        }
    }

    private parseTerm(): Result<number> {
        let left = this.parseUnary();
        if (!left.isOk) return left;
        for (;;) {
            this.skipSpaces();
            const op = this.source[this.pos];
            if (op !== "*" && op !== "/" && op !== "%") return left;
            this.pos++;
            const right = this.parseUnary();
            if (!right.isOk) return right;
            if ((op === "/" || op === "%") && right.value === 0) return Result.err("Division by zero");
            const value =
                op === "*"
                    ? left.value * right.value
                    : op === "/"
                      ? left.value / right.value
                      : left.value % right.value;
            left = Result.ok(value);
        }
    }

    private parseUnary(): Result<number> {
        this.skipSpaces();
        const op = this.source[this.pos];
        if (op === "-" || op === "+") {
            this.pos++;
            const value = this.parseUnary();
            return value.isOk ? Result.ok(op === "-" ? -value.value : value.value) : value;
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Result<number> {
        this.skipSpaces();
        const ch = this.source[this.pos];
        if (ch === undefined) return Result.err("Unexpected end of expression");
        if (ch === "(") return this.parseParenthesized();
        if (/\d|\./.test(ch)) return this.parseNumber();
        if (/[A-Za-z_]/.test(ch)) return this.parseIdentifier();
        return Result.err(`Unexpected character: ${ch}`);
    }

    private parseParenthesized(): Result<number> {
        this.pos++;
        const value = this.parseExpression();
        if (!value.isOk) return value;
        this.skipSpaces();
        if (this.source[this.pos] !== ")") return Result.err("Missing closing parenthesis");
        this.pos++;
        return value;
    }

    private parseNumber(): Result<number> {
        const match = /^\d*\.?\d+([eE][+-]?\d+)?/.exec(this.source.slice(this.pos));
        if (match === null) return Result.err(`Unexpected character: ${this.source[this.pos]}`);
        this.pos += match[0].length;
        return Result.ok(Number(match[0]));
    }

    private parseIdentifier(): Result<number> {
        const match = /^[A-Za-z_]\w*/.exec(this.source.slice(this.pos))!;
        const name = match[0];
        this.pos += name.length;
        this.skipSpaces();
        if (this.source[this.pos] === "(") return this.parseFunction(name);
        if (this.scope.has(name)) return Result.ok(this.scope.get(name)!);
        if (name in CONSTANTS) return Result.ok(CONSTANTS[name]);
        return Result.err(`Unknown identifier: ${name}`);
    }

    private parseFunction(name: string): Result<number> {
        this.pos++;
        const args: number[] = [];
        this.skipSpaces();
        if (this.source[this.pos] !== ")") {
            for (;;) {
                const arg = this.parseExpression();
                if (!arg.isOk) return arg;
                args.push(arg.value);
                this.skipSpaces();
                if (this.source[this.pos] !== ",") break;
                this.pos++;
                this.skipSpaces();
            }
        }
        if (this.source[this.pos] !== ")") return Result.err("Missing closing parenthesis");
        this.pos++;
        const fn = FUNCTIONS[name];
        if (fn === undefined) return Result.err(`Unknown function: ${name}`);
        return Result.ok(fn(...args));
    }
}
