// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "../foundation/result";
import {
    ANGLE_UNITS,
    combineUnitSpecs,
    mergeUnitSpecs,
    UNITLESS,
    type UnitSpec,
    unitSpecEquals,
    unitSpecLabel,
    unitSpecRoot,
} from "./unitSpec";

/** Parameter values: a literal number or an expression string like `width * 2 + 10`. */
export type ParameterValue = number | string;

/** A resolved value plus the unit it carries. */
export interface EvaluatedValue {
    readonly value: number;
    readonly unit: UnitSpec;
}

/** Named values an expression resolves against, each carrying its declared unit. */
export type Scope = ReadonlyMap<string, EvaluatedValue>;

export const EMPTY_SCOPE: Scope = new Map();

/**
 * Trigonometric functions take degrees and inverse ones return degrees, matching the
 * app's angle convention — `Math.*` works in radians, so every one of them converts.
 */
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
    asin: (x) => (Math.asin(x) * 180) / Math.PI,
    acos: (x) => (Math.acos(x) * 180) / Math.PI,
    atan: (x) => (Math.atan(x) * 180) / Math.PI,
    atan2: (y, x) => (Math.atan2(y, x) * 180) / Math.PI,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/**
 * How many arguments each function takes — `[min, max]`. The parser accepts any count, so
 * the check belongs here: without it `sin()` indexed `args[0]` and threw a TypeError out of
 * `evaluateExpression`, which is a `Result`-returning boundary and must report, not throw.
 */
const FUNCTION_ARITY: Record<string, readonly [min: number, max: number]> = {
    abs: [1, 1],
    sqrt: [1, 1],
    floor: [1, 1],
    ceil: [1, 1],
    round: [1, 1],
    sin: [1, 1],
    cos: [1, 1],
    tan: [1, 1],
    asin: [1, 1],
    acos: [1, 1],
    atan: [1, 1],
    atan2: [2, 2],
    min: [1, Number.POSITIVE_INFINITY],
    max: [1, Number.POSITIVE_INFINITY],
};

/** Roots: the unit's exponents are halved, so they must be even to begin with. */
const ROOT_FUNCTIONS = new Set(["sqrt"]);
/** Functions that require an angle and yield a unitless ratio. */
const TRIG_FUNCTIONS = new Set(["sin", "cos", "tan"]);
/** The reverse: a unitless ratio in, an angle out. */
const INVERSE_TRIG_FUNCTIONS = new Set(["asin", "acos", "atan"]);
/** Functions that pass their argument's unit straight through. */
const PASSTHROUGH_FUNCTIONS = new Set(["abs", "floor", "ceil", "round"]);
/** Functions whose arguments must all agree on one unit. */
const MERGE_FUNCTIONS = new Set(["min", "max"]);

/** Constant names may not be shadowed by variables — the same expression would
 * otherwise evaluate differently depending on whether a same-named variable exists. */
export function isConstantName(name: string): boolean {
    // `in` would answer yes for every Object.prototype member, so a parameter legitimately
    // named `constructor` would be rejected as shadowing a constant that does not exist.
    return Object.hasOwn(CONSTANTS, name);
}

/**
 * Safe arithmetic expression evaluator (no `eval`): `+ - * / %`, parentheses, unary
 * minus, the functions above, `pi`/`e`, and identifiers resolved from `scope`.
 *
 * Every value carries a `UnitSpec`, and each operation propagates it: `+ - %` require
 * both sides to agree (a unitless side adopts the other's unit), `* /` add and
 * subtract the exponents, `sin`/`cos`/`tan` take an angle and yield a ratio. Literals
 * are unitless and so are adoptable, which is what lets `depth = 50` and `w + 1` both
 * work while `w + angle` is rejected.
 */
export function evaluateExpression(source: string, scope: Scope): Result<EvaluatedValue> {
    const parser = new Parser(source, scope);
    const value = parser.parseExpression();
    if (!value.isOk) return value;
    parser.skipSpaces();
    if (!parser.atEnd()) return Result.err(`Unexpected character: ${parser.current()}`);
    if (!Number.isFinite(value.value.value)) return Result.err("Expression result is not a finite number");
    return value;
}

/**
 * Resolves a feature parameter to a concrete number against the variable scope,
 * rejecting a unit that does not fit the slot. A unitless result fits any slot —
 * the same adoptability literals have.
 */
export function resolveUnitSpec(value: ParameterValue, scope: Scope, expected: UnitSpec): Result<number> {
    if (typeof value === "number") return Result.ok(value);
    const evaluated = evaluateExpression(value, scope);
    if (!evaluated.isOk) return Result.err(evaluated.error);
    const actual = evaluated.value.unit;
    if (!unitSpecEquals(actual, UNITLESS) && !unitSpecEquals(actual, expected)) {
        return Result.err(
            `Dimension mismatch: expected ${unitSpecLabel(expected)}, got ${unitSpecLabel(actual)}`,
        );
    }
    return Result.ok(evaluated.value.value);
}

/**
 * A text input as a parameter value: a number when it reads as one, otherwise the text
 * itself, to be resolved as an expression later. Shared by every editor that accepts a
 * parameter — the command context, the feature panel and the sketch datum dialog — so
 * they all agree on where "50" stops being a literal.
 */
export function parseParameterValue(text: string): ParameterValue {
    const trimmed = text.trim();
    const value = Number(trimmed);
    return trimmed !== "" && Number.isFinite(value) ? value : trimmed;
}

/** Merged unit spec of an additive pair, or an error naming the conflict. */
function additiveUnitSpec(left: UnitSpec, right: UnitSpec): Result<UnitSpec> {
    const merged = mergeUnitSpecs(left, right);
    if (merged !== undefined) return Result.ok(merged);
    return Result.err(
        `Dimension mismatch: cannot combine ${unitSpecLabel(left)} with ${unitSpecLabel(right)}`,
    );
}

class Parser {
    private pos = 0;

    constructor(
        private readonly source: string,
        private readonly scope: Scope,
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

    parseExpression(): Result<EvaluatedValue> {
        let left = this.parseTerm();
        if (!left.isOk) return left;
        for (;;) {
            this.skipSpaces();
            const op = this.source[this.pos];
            if (op !== "+" && op !== "-") return left;
            this.pos++;
            const right = this.parseTerm();
            if (!right.isOk) return right;
            const unit = additiveUnitSpec(left.value.unit, right.value.unit);
            if (!unit.isOk) return Result.err(unit.error);
            left = Result.ok({
                value:
                    op === "+" ? left.value.value + right.value.value : left.value.value - right.value.value,
                unit: unit.value,
            });
        }
    }

    private parseTerm(): Result<EvaluatedValue> {
        let left = this.parseUnary();
        if (!left.isOk) return left;
        for (;;) {
            this.skipSpaces();
            const op = this.source[this.pos];
            if (op !== "*" && op !== "/" && op !== "%") return left;
            this.pos++;
            const right = this.parseUnary();
            if (!right.isOk) return right;
            if ((op === "/" || op === "%") && right.value.value === 0) {
                return Result.err("Division by zero");
            }
            // `%` is the remainder of a division, so it stays within the operands'
            // unit the same way `+`/`-` do; only `*` and `/` move the exponents.
            if (op === "%") {
                const unit = additiveUnitSpec(left.value.unit, right.value.unit);
                if (!unit.isOk) return Result.err(unit.error);
                left = Result.ok({
                    value: left.value.value % right.value.value,
                    unit: unit.value,
                });
                continue;
            }
            const value =
                op === "*" ? left.value.value * right.value.value : left.value.value / right.value.value;
            left = Result.ok({
                value,
                unit: combineUnitSpecs(left.value.unit, right.value.unit, op === "*" ? 1 : -1),
            });
        }
    }

    private parseUnary(): Result<EvaluatedValue> {
        this.skipSpaces();
        const op = this.source[this.pos];
        if (op === "-" || op === "+") {
            this.pos++;
            const value = this.parseUnary();
            if (!value.isOk) return value;
            return Result.ok({
                value: op === "-" ? -value.value.value : value.value.value,
                unit: value.value.unit,
            });
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Result<EvaluatedValue> {
        this.skipSpaces();
        const ch = this.source[this.pos];
        if (ch === undefined) return Result.err("Unexpected end of expression");
        if (ch === "(") return this.parseParenthesized();
        if (/\d|\./.test(ch)) return this.parseNumber();
        if (/[A-Za-z_]/.test(ch)) return this.parseIdentifier();
        return Result.err(`Unexpected character: ${ch}`);
    }

    private parseParenthesized(): Result<EvaluatedValue> {
        this.pos++;
        const value = this.parseExpression();
        if (!value.isOk) return value;
        this.skipSpaces();
        if (this.source[this.pos] !== ")") return Result.err("Missing closing parenthesis");
        this.pos++;
        return value;
    }

    private parseNumber(): Result<EvaluatedValue> {
        const match = /^\d*\.?\d+([eE][+-]?\d+)?/.exec(this.source.slice(this.pos));
        if (match === null) return Result.err(`Unexpected character: ${this.source[this.pos]}`);
        this.pos += match[0].length;
        return Result.ok({ value: Number(match[0]), unit: UNITLESS });
    }

    private parseIdentifier(): Result<EvaluatedValue> {
        const match = /^[A-Za-z_]\w*/.exec(this.source.slice(this.pos));
        if (match === null) return Result.err(`Unexpected character: ${this.source[this.pos]}`);
        const name = match[0];
        this.pos += name.length;
        this.skipSpaces();
        if (this.source[this.pos] === "(") return this.parseFunction(name);
        const scoped = this.scope.get(name);
        if (scoped !== undefined) return Result.ok(scoped);
        if (Object.hasOwn(CONSTANTS, name)) return Result.ok({ value: CONSTANTS[name], unit: UNITLESS });
        return Result.err(`Unknown identifier: ${name}`);
    }

    private parseFunction(name: string): Result<EvaluatedValue> {
        this.pos++;
        const args: EvaluatedValue[] = [];
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
        // `FUNCTIONS[name]` alone would find `Object.prototype.toString` and call it.
        const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
        if (fn === undefined) return Result.err(`Unknown function: ${name}`);
        const unit = functionUnitSpec(name, args);
        if (!unit.isOk) return Result.err(unit.error);
        return Result.ok({ value: fn(...args.map((x) => x.value)), unit: unit.value });
    }
}

/** The unit spec a function call yields, or the error when its arguments cannot fit it. */
function functionUnitSpec(name: string, args: readonly EvaluatedValue[]): Result<UnitSpec> {
    const arity = FUNCTION_ARITY[name];
    if (arity !== undefined && (args.length < arity[0] || args.length > arity[1])) {
        return Result.err(`${name}() expects ${describeArity(arity)}, got ${args.length}`);
    }
    if (ROOT_FUNCTIONS.has(name)) {
        const root = unitSpecRoot(args[0].unit);
        if (root === undefined) {
            return Result.err(`${name}() expects even unit exponents, got ${unitSpecLabel(args[0].unit)}`);
        }
        return Result.ok(root);
    }
    if (TRIG_FUNCTIONS.has(name)) {
        const argument = args[0].unit;
        if (!unitSpecEquals(argument, ANGLE_UNITS) && !unitSpecEquals(argument, UNITLESS)) {
            return Result.err(`${name}() expects an angle, got ${unitSpecLabel(argument)}`);
        }
        return Result.ok(UNITLESS);
    }
    if (INVERSE_TRIG_FUNCTIONS.has(name)) {
        const argument = args[0].unit;
        if (!unitSpecEquals(argument, UNITLESS)) {
            return Result.err(`${name}() expects a unitless ratio, got ${unitSpecLabel(argument)}`);
        }
        return Result.ok(ANGLE_UNITS);
    }
    if (name === "atan2") {
        // The angle comes from the RATIO of the two arguments, so they have to measure
        // the same thing: `atan2(w, 5)` is fine (a literal is adoptable), `atan2(w, angle)`
        // is not.
        if (mergeUnitSpecs(args[0].unit, args[1].unit) === undefined) {
            return Result.err(
                `atan2() mixes ${unitSpecLabel(args[0].unit)} with ${unitSpecLabel(args[1].unit)}`,
            );
        }
        return Result.ok(ANGLE_UNITS);
    }
    if (PASSTHROUGH_FUNCTIONS.has(name)) return Result.ok(args[0].unit);
    if (MERGE_FUNCTIONS.has(name)) {
        let merged: UnitSpec = UNITLESS;
        for (const arg of args) {
            const next = mergeUnitSpecs(merged, arg.unit);
            if (next === undefined) {
                return Result.err(`${name}() mixes ${unitSpecLabel(merged)} with ${unitSpecLabel(arg.unit)}`);
            }
            merged = next;
        }
        return Result.ok(merged);
    }
    // Unreachable: `parseFunction` rejects unknown names before calling this.
    return Result.ok(args[0].unit);
}

/** A count range as the error message says it: `1 argument`, `at least 1 argument`, `2 arguments`. */
function describeArity([min, max]: readonly [number, number]): string {
    if (min === max) return `${min} argument${min === 1 ? "" : "s"}`;
    if (max === Number.POSITIVE_INFINITY) return `at least ${min} argument${min === 1 ? "" : "s"}`;
    return `${min} to ${max} arguments`;
}
