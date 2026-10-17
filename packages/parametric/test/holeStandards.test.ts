// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { HOLE_STANDARDS, parsePresetToken, presetTokens } from "../src/features/holeStandards";

describe("hole standards table", () => {
    test("the clearance classes widen strictly, and every recess clears its hole", () => {
        for (const row of HOLE_STANDARDS) {
            expect(row.clearance.close).toBeLessThan(row.clearance.normal);
            expect(row.clearance.normal).toBeLessThan(row.clearance.loose);
            // A recess must swallow the screw head, so it is wider than the clearance hole.
            expect(row.counterbore.diameter).toBeGreaterThan(row.clearance.normal);
            expect(row.counterbore.depth).toBeGreaterThan(0);
            if (row.countersink !== undefined) {
                expect(row.countersink.diameter).toBeGreaterThan(row.clearance.normal);
                expect(row.countersink.angle).toBe(90);
            }
        }
    });

    test("M8 carries the ISO values the table promises", () => {
        const m8 = HOLE_STANDARDS.find((x) => x.size === "M8")!;
        expect(m8.clearance).toEqual({ close: 8.4, normal: 9.0, loose: 10.0 });
        // ISO 4762: dk(max) 13 + 1 of clearance; head height k = 8 sits flush.
        expect(m8.counterbore).toEqual({ diameter: 14, depth: 8 });
        // ISO 10642: theoretical dk at the 90° flat head.
        expect(m8.countersink).toEqual({ diameter: 17.92, angle: 90 });
    });

    test("M14 is the one size without a countersink row", () => {
        const m14 = HOLE_STANDARDS.find((x) => x.size === "M14")!;
        expect(m14.countersink).toBeUndefined();
        expect(HOLE_STANDARDS.filter((x) => x.countersink === undefined)).toEqual([m14]);
    });

    test("preset tokens count the rows they cover", () => {
        expect(presetTokens("simple")).toHaveLength(HOLE_STANDARDS.length * 3);
        expect(presetTokens("counterbore")).toHaveLength(HOLE_STANDARDS.length);
        expect(presetTokens("countersink")).toHaveLength(HOLE_STANDARDS.length - 1);
    });

    test("every offered token parses back to its own row", () => {
        for (const style of ["simple", "counterbore", "countersink"] as const) {
            for (const token of presetTokens(style)) {
                const parsed = parsePresetToken(token);
                expect(parsed).toBeDefined();
                expect(token.startsWith(parsed!.row.size)).toBe(true);
            }
        }
    });

    test("a simple token names its clearance class; a recess token defaults to normal", () => {
        expect(parsePresetToken("M8 · loose · ⌀10")?.clearance).toBe("loose");
        expect(parsePresetToken("M8 · ⌀9 / ⌀14×8")?.clearance).toBe("normal");
    });

    test("an unrecognized token selects nothing", () => {
        expect(parsePresetToken("")).toBeUndefined();
        expect(parsePresetToken("1/4-20 UNC")).toBeUndefined();
        expect(parsePresetToken("M99 · normal · ⌀100")).toBeUndefined();
    });
});
