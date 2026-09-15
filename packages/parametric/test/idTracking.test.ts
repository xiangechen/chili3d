// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ancestorInputs, combineIds, idsOverlap } from "../src/features/feature";

describe("combineIds", () => {
    test("a single ancestor keeps its id bit-for-bit", () => {
        expect(combineIds(["e1:3"])).toBe("e1:3");
    });

    test("several ancestors form a sorted deduped compound", () => {
        expect(combineIds(["b", "a", "b"])).toBe("a|b");
    });

    test("nested compounds are flattened to leaf components", () => {
        expect(combineIds(["a|b", "c", "b"])).toBe("a|b|c");
    });
});

describe("idsOverlap", () => {
    test.each([
        ["a", "a", true],
        ["a|b", "a", true],
        ["a", "a|b", true],
        ["a|b", "b|c", true],
        ["a|b", "c|d", false],
        ["a", "b", false],
    ])("idsOverlap(%j, %j) === %j", (a, b, expected) => {
        expect(idsOverlap(a, b)).toBe(expected);
    });
});

describe("ancestorInputs", () => {
    test("seeds single-ancestor lists from the map, empty for new sub-shapes", () => {
        expect(ancestorInputs([0, -1, 2])).toEqual([[0], [], [2]]);
    });

    test("the derivation pairs add the ancestors the single-valued map dropped", () => {
        // Output 1 was merged from inputs 0 and 3; the map kept the first.
        expect(ancestorInputs([0, 0, 2], [0, 0, 1, 0, 1, 3, 2, 2])).toEqual([[0], [0, 3], [2]]);
    });

    test("out-of-range or duplicate pairs are ignored", () => {
        expect(ancestorInputs([1], [5, 0, 0, 1, 0, 1])).toEqual([[1]]);
    });
});
