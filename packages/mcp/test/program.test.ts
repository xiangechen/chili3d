// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { collectConsumed } from "../src/program/interpreter";
import { ProgramSchema } from "../src/program/schema";

// Pure-TS coverage (no WASM): schema validation and consumed-id analysis.
describe("CAD program schema", () => {
    test("accepts a valid rect -> extrude program", () => {
        const result = ProgramSchema.safeParse({
            ops: [
                { op: "rect", id: "r", dx: 10, dy: 10 },
                { op: "extrude", id: "e", section: { ref: "r" }, length: 5 },
            ],
        });
        expect(result.success).toBe(true);
    });

    test("rejects unknown ops, non-positive sizes, and empty programs", () => {
        expect(ProgramSchema.safeParse({ ops: [{ op: "nope", id: "x" }] }).success).toBe(false);
        expect(ProgramSchema.safeParse({ ops: [{ op: "box", id: "b", dx: -1, dy: 1, dz: 1 }] }).success).toBe(
            false,
        );
        expect(ProgramSchema.safeParse({ ops: [] }).success).toBe(false);
    });

    test("collectConsumed returns ids referenced by later ops", () => {
        const consumed = collectConsumed([
            { op: "rect", id: "r", dx: 1, dy: 1 },
            { op: "extrude", id: "e", section: { ref: "r" }, length: 1 },
            { op: "box", id: "b", dx: 1, dy: 1, dz: 1 },
            { op: "boolean", id: "c", kind: "cut", a: { ref: "e" }, b: { ref: "b" } },
        ] as never);
        expect([...consumed].sort()).toEqual(["b", "e", "r"]);
    });
});
