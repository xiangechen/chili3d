// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { evaluateExpression, resolveNumber } from "../src/features/expression";

const scope = (entries: Record<string, number> = {}) => new Map(Object.entries(entries));

describe("evaluateExpression", () => {
    test.each([
        { source: "42", expected: 42 },
        { source: "1 + 2 * 3", expected: 7 },
        { source: "(1 + 2) * 3", expected: 9 },
        { source: "-3 + -2", expected: -5 },
        { source: "10 / 4", expected: 2.5 },
        { source: "7 % 3", expected: 1 },
        { source: "2 * -3", expected: -6 },
        { source: "1e2 + 0.5", expected: 100.5 },
    ])("evaluates `$source` to $expected", ({ source, expected }) => {
        expect(evaluateExpression(source, scope()).unchecked()).toBe(expected);
    });

    test("resolves identifiers from the scope", () => {
        expect(evaluateExpression("width * 2 + depth", scope({ width: 10, depth: 5 })).unchecked()).toBe(25);
    });

    test("supports functions, constants and nested calls", () => {
        expect(evaluateExpression("max(2, min(10, 4))", scope()).unchecked()).toBe(4);
        expect(evaluateExpression("sqrt(16) + abs(-2)", scope()).unchecked()).toBe(6);
        expect(evaluateExpression("cos(60)", scope()).unchecked()).toBeCloseTo(0.5);
        expect(evaluateExpression("pi", scope()).unchecked()).toBeCloseTo(Math.PI);
    });

    test.each([
        { source: "", error: "Unexpected end of expression" },
        { source: "1 +", error: "Unexpected end of expression" },
        { source: "unknown", error: "Unknown identifier: unknown" },
        { source: "foo(1)", error: "Unknown function: foo" },
        { source: "(1 + 2", error: "Missing closing parenthesis" },
        { source: "1 / 0", error: "Division by zero" },
        { source: "1 2", error: "Unexpected character: 2" },
        { source: "1 + @", error: "Unexpected character: @" },
    ])("rejects `$source` with `$error`", ({ source, error }) => {
        const result = evaluateExpression(source, scope());
        expect(result.isOk).toBe(false);
        expect(result.error).toBe(error);
    });
});

describe("resolveNumber", () => {
    test("passes numbers through and evaluates strings", () => {
        expect(resolveNumber(7, scope()).unchecked()).toBe(7);
        expect(resolveNumber("width + 1", scope({ width: 2 })).unchecked()).toBe(3);
        expect(resolveNumber("oops", scope()).isOk).toBe(false);
    });
});
