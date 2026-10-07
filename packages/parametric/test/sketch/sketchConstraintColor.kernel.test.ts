// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The colour array `constraintEdgeColors` builds assumes the kernel reports one range per
// edge, in edge order, and that those ranges tile the mesh's vertices exactly. That is an
// assumption about the kernel's mesh, so it is checked against a real one here.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Plane, XYZ } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { constraintEdgeColors, SketchNode } from "../../src/sketch/sketchNode";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

let factory: ShapeFactory;

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    factory = new ShapeFactory();
    Object.defineProperty(globalThis, "shapeFactory", { value: factory, writable: true });
});

describe("constraintEdgeColors against a real mesh", () => {
    test("ranges tile every vertex, one per edge, in order", () => {
        const parts = [
            factory.line(new XYZ(0, 0, 0), new XYZ(10, 0, 0)),
            factory.circle(new XYZ(0, 0, 1), new XYZ(5, 5, 0), 3),
            factory.line(new XYZ(10, 0, 0), new XYZ(10, 10, 0)),
        ];
        expect(parts.filter((part) => !part.isOk).map((part) => part.error)).toEqual([]);

        const combined = factory.combine(parts.map((part) => part.value));
        expect(combined.isOk).toBe(true);

        const edges = combined.value.mesh.edges;
        if (edges === undefined) throw new Error("the compound mesh reported no edges");
        const range = edges.range;

        // one range per edge, and together they cover every vertex exactly once
        expect(range).toHaveLength(3);
        const vertexCount = edges.position.length / 3;
        expect(range.reduce((total, span) => total + span.count, 0)).toBe(vertexCount);

        // so the colour array lands one triple per vertex, with the pinned/unpinned split
        // sitting exactly where the ranges say it does
        const colors = constraintEdgeColors(range, [1, 2, 3], new Set([1, 3]));
        expect(colors).toHaveLength(vertexCount * 3);
        const secondEdgeStart = range[0].count;
        expect(colors.slice(0, 3)).not.toEqual(colors.slice(secondEdgeStart * 3, secondEdgeStart * 3 + 3));
    });

    test("a SketchNode paints its own mesh by constraint state", () => {
        const node = new SketchNode({
            document: createMockDocument(),
            plane: Plane.XY,
            data: {
                entities: [
                    { id: 1, type: "line", params: [0, 0, 10, 0] },
                    { id: 2, type: "line", params: [10, 0, 10, 10] },
                ],
                constraints: [],
            },
        });
        node.setShowProfileFaces(false);
        node.shape = node.generateShape();

        // with nothing colouring, the mesh keeps the single flat colour the kernel gave it
        expect(typeof node.mesh.edges?.color).toBe("number");

        node.setConstraintColors(new Set([1]));
        const edges = node.mesh.edges;
        if (edges === undefined) throw new Error("the sketch node reported no edges");
        const colors = edges.color;
        expect(Array.isArray(colors)).toBe(true);
        // one rgb triple per vertex, so the array is exactly as long as the positions
        expect(colors as number[]).toHaveLength(edges.position.length);
        // entity 1 is pinned and entity 2 is not: the two edges read apart
        expect((colors as number[]).slice(0, 3)).not.toEqual((colors as number[]).slice(6, 9));

        // and leaving the session takes the colouring back off
        node.setConstraintColors(undefined);
        expect(typeof node.mesh.edges?.color).toBe("number");
    });
});
