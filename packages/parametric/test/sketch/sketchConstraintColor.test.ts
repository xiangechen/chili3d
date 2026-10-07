// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DefaultSketchFreeColor, VisualConfig } from "@chili3d/core";
import { sketchConstraintColor } from "../../src/sketch/sketchModel";
import { constraintEdgeColors } from "../../src/sketch/sketchNode";
import "./setup";

/** RGB triples, one per vertex — the layout `constraintEdgeColors` emits. */
function vertexColors(colors: number[]): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < colors.length; i += 3) out.push(colors.slice(i, i + 3));
    return out;
}

describe("sketchConstraintColor", () => {
    test("a pinned entity takes the default edge colour, a free one the free colour", () => {
        expect(sketchConstraintColor(new Set([7]), 7)).toBe(VisualConfig.defaultEdgeColor);
        expect(sketchConstraintColor(new Set([7]), 8)).toBe(VisualConfig.sketchFreeColor);
        expect(sketchConstraintColor(new Set(), 7)).toBe(VisualConfig.sketchFreeColor);
    });

    test("with no session colouring, nothing is pinned", () => {
        expect(sketchConstraintColor(undefined, 7)).toBe(VisualConfig.sketchFreeColor);
    });

    test("the free colour is the configured one, and reads apart from the pinned colour", () => {
        expect(VisualConfig.sketchFreeColor).toBe(DefaultSketchFreeColor);
        expect(VisualConfig.sketchFreeColor).not.toBe(VisualConfig.defaultEdgeColor);
    });
});

describe("constraintEdgeColors", () => {
    test("each entity's vertex span takes its own colour", () => {
        // line (2 vertices), circle (6), line (2) — `range.count` is the vertex span
        const ranges = [{ count: 2 }, { count: 6 }, { count: 2 }];
        const vertices = vertexColors(constraintEdgeColors(ranges, [10, 20, 30], new Set([10, 30])));

        expect(vertices).toHaveLength(10);
        const pinned = vertices[0];
        const free = vertices[2];
        expect(pinned).not.toEqual(free);

        // entity 10 and entity 30 are pinned, entity 20 is not
        expect(vertices.slice(0, 2)).toEqual([pinned, pinned]);
        expect(vertices.slice(2, 8)).toEqual([free, free, free, free, free, free]);
        expect(vertices.slice(8, 10)).toEqual([pinned, pinned]);
    });

    test("nothing pinned means every vertex takes the free colour", () => {
        const vertices = vertexColors(constraintEdgeColors([{ count: 3 }, { count: 2 }], [1, 2], new Set()));
        expect(vertices).toHaveLength(5);
        expect(new Set(vertices.map((v) => v.join(","))).size).toBe(1);
    });

    test("everything pinned means every vertex takes the default colour", () => {
        const vertices = vertexColors(
            constraintEdgeColors([{ count: 3 }, { count: 2 }], [1, 2], new Set([1, 2])),
        );
        expect(vertices).toHaveLength(5);
        expect(new Set(vertices.map((v) => v.join(","))).size).toBe(1);
    });

    test("no edges yields no colours", () => {
        expect(constraintEdgeColors([], [], new Set())).toEqual([]);
    });

    test("the colours come off VisualConfig, sRGB converted to linear", () => {
        const original = VisualConfig.sketchFreeColor;
        try {
            VisualConfig.sketchFreeColor = 0xff0000;
            // pure red is 1 in linear space and 0 elsewhere, whatever the srgb curve does
            expect(vertexColors(constraintEdgeColors([{ count: 1 }], [7], new Set()))[0]).toEqual([1, 0, 0]);

            VisualConfig.sketchFreeColor = 0xffffff;
            expect(vertexColors(constraintEdgeColors([{ count: 1 }], [7], new Set()))[0]).toEqual([1, 1, 1]);
        } finally {
            VisualConfig.sketchFreeColor = original;
        }
    });
});
