// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ancestorInputs, combineIds, idsOverlap, prefixedId, uncontested } from "../src/features/trackedId";

describe("prefixedId", () => {
    test("a plain id takes the prefix once", () => {
        expect(prefixedId("f1", "sketch:sk1:e1")).toBe("f1:sketch:sk1:e1");
    });

    test("EVERY leaf takes it — a compound id must not leave its later leaves bare", () => {
        // Prefixing the whole string would yield `f1:a|b`, whose `b` leaf would then live in the
        // host's own id space as a bare id, matching unrelated sub-shapes through `idsOverlap`.
        expect(prefixedId("f1", "a|b")).toBe("f1:a|f1:b");
        expect(prefixedId("f1", "a|b|c")).toBe("f1:a|f1:b|f1:c");
    });

    test("the prefixed id no longer overlaps the id it came from", () => {
        // What makes the corner scope work: a corner's name must not intersect the input edge's own
        // id, or the two would read as pieces of one sub-shape.
        expect(idsOverlap(prefixedId("f1", "a|b"), "a|b")).toBe(false);
        expect(idsOverlap(prefixedId("f1", "a"), prefixedId("f2", "a"))).toBe(false);
    });
});

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

describe("uncontested", () => {
    test("an id no sibling shares survives", () => {
        expect([
            ...uncontested(
                new Map([
                    [0, "a"],
                    [1, "b"],
                ]),
            ),
        ]).toEqual([
            [0, "a"],
            [1, "b"],
        ]);
    });

    test("a shared id is dropped from BOTH sub-shapes", () => {
        // Component-wise, so a compound that overlaps is contested too.
        expect([
            ...uncontested(
                new Map([
                    [0, "a"],
                    [1, "a|b"],
                ]),
            ),
        ]).toEqual([]);
    });

    test("EXACT duplicates are contested — the self-comparison must not excuse them", () => {
        // The commonest collision there is: two sub-shapes computing the same name. Comparing
        // by value skipped the equal sibling along with the entry itself, and both survived.
        expect([
            ...uncontested(
                new Map([
                    [0, "a"],
                    [1, "a"],
                ]),
            ),
        ]).toEqual([]);
    });
});
