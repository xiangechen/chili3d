// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Plane, Result, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { registerFeature, type SewFeatureData } from "../src/features/feature";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";
import "./sketch/setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wasm/lib/chili-wasm.wasm"),
);

// A parametric chain has no built-in face-producing feature (sketch profiles are closed
// loops extruded to solids), so the test registers a throwaway one: two square faces side
// by side, sharing the edge at x = 10 — exactly what a sew stitches together.
registerFeature("testFacePair", {
    display: "command.feature.sew",
    nodeIds: () => [],
    parameters: () => [],
    setParameter: (feature) => feature,
    evaluate: () => {
        const left = shapeFactory.rect(Plane.XY, 10, 10);
        const right = shapeFactory.rect(Plane.XY.translateTo({ x: 10, y: 0, z: 0 } as any), 10, 10);
        if (!left.isOk) return Result.err(left.error);
        if (!right.isOk) return Result.err(right.error);
        const combined = shapeFactory.combine([left.value, right.value]);
        return combined.isOk ? Result.ok(combined.value) : Result.err(combined.error);
    },
});

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

function bodyWith(doc: TestDocument, features: any[]) {
    const body = new ParametricBodyNode({ document: doc, id: "b1", features });
    doc.modelManager.addNode(body);
    return body;
}

function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

describe("sew feature", () => {
    test("two loose faces sew into one shell — the shared edge merges", () => {
        const doc = setup();
        const body = bodyWith(doc, [
            { id: "t1", type: "testFacePair" },
            { id: "s1", type: "sew" } satisfies SewFeatureData as any,
        ]);

        expect(body.shape.isOk).toBe(true);
        const sewn = body.shape.unchecked()!;
        expect(sewn.findSubShapes(ShapeTypes.face).length).toBe(2);
        // Two separate squares carry 8 edge instances; after the sew the shared edge is
        // one edge, oriented forward on one face and reversed on the other.
        expect(sewn.findSubShapes(ShapeTypes.edge).length).toBe(7);
        expect(sewn.findSubShapes(ShapeTypes.shell).length).toBe(1);
    });

    test("a solid input is an error, not a pass-through", () => {
        const doc = setup();
        const sketch = new SketchNode({
            document: doc,
            id: "sk1",
            plane: Plane.XY,
            data: rect(0, 0, 10, 10),
        });
        doc.modelManager.addNode(sketch);
        const body = bodyWith(doc, [
            { id: "e1", type: "extrude", sketchId: sketch.id, depth: 10 },
            { id: "s1", type: "sew" },
        ]);

        // Constructed with the failing feature: the chain result itself is the error.
        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe(
            "Sew expects faces or shells — there is nothing to sew on a solid",
        );
    });

    test("a non-positive tolerance is a rebuild error", () => {
        const doc = setup();
        const body = bodyWith(doc, [
            { id: "t1", type: "testFacePair" },
            { id: "s1", type: "sew", tolerance: 0 } satisfies SewFeatureData as any,
        ]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe("Sew requires a positive tolerance");
    });

    test("sew as the first feature requires a preceding feature", () => {
        const doc = setup();
        const body = bodyWith(doc, [{ id: "s1", type: "sew" }]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Sew requires a preceding feature");
    });
});
