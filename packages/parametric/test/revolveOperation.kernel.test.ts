// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A revolve carrying a join/cut/intersect combines the revolved solid with the chain
 * input of the body it is appended to (the extrude/sweep contract, see
 * `applyTrackedOperation`). The command never built such a body before; this locks the
 * feature side against the real kernel.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { RevolveFeatureData } from "../src/features/feature";
import { allProfiles, sketchProfiles } from "../src/features/profileBuilder";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
import "./sketch/setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

const rect = (x1: number, y1: number, x2: number, y2: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x1, y1, x2, y1] },
        { id: 2, type: "line", params: [x2, y1, x2, y2] },
        { id: 3, type: "line", params: [x2, y2, x1, y2] },
        { id: 4, type: "line", params: [x1, y2, x1, y1] },
    ],
    constraints: [],
});

/** A 40×40×40 box centred on the origin in XY, extruded from a sketch so its ids are tracked. */
function box(doc: TestDocument): ParametricBodyNode {
    const sketch = new SketchNode({
        document: doc,
        id: "sk1",
        plane: Plane.XY,
        data: rect(-20, -20, 20, 20),
    });
    doc.modelManager.addNode(sketch);
    const profiles = sketchProfiles(sketch);
    expect(profiles.isOk).toBe(true);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 40,
                profiles: [captureProfileRef(allProfiles(profiles.value)[0])],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

/** The single sketch-space profile of `sketch`, as the fingerprint a pick would store. */
function profileOf(sketch: SketchNode) {
    const profiles = sketchProfiles(sketch);
    expect(profiles.isOk).toBe(true);
    const all = allProfiles(profiles.value);
    expect(all).toHaveLength(1);
    return captureProfileRef(all[0]);
}

const facesOf = (body: ParametricBodyNode): IFace[] =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];

/** A full-turn revolve of a 50×50 rectangle about the Y axis: a cylinder of radius 50. */
function cylinderRevolve(doc: TestDocument, operation?: "cut" | "fuse"): RevolveFeatureData {
    const sketch = new SketchNode({ document: doc, id: "sk2", plane: Plane.XY, data: rect(0, -25, 50, 25) });
    doc.modelManager.addNode(sketch);
    return {
        id: "r1",
        type: "revolve",
        sketchId: sketch.id,
        axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
        angle: 360,
        profiles: [profileOf(sketch)],
        ...(operation === undefined ? {} : { operation }),
    };
}

describe("a revolve carrying an operation (real kernel)", () => {
    test("cut subtracts the revolved solid from the body it is appended to", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = box(doc);
        expect(facesOf(body)).toHaveLength(6);

        body.setFeaturesEmitShapeChanged([...body.features, cylinderRevolve(doc, "cut")]);

        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        // The cylinder swallows the box whole, so nothing is left of it.
        expect(facesOf(body)).toHaveLength(0);
    });

    test("fuse keeps the revolved solid beside the body it joins", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = box(doc);

        body.setFeaturesEmitShapeChanged([...body.features, cylinderRevolve(doc, "fuse")]);

        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        // The union of the box with a radius-50 cylinder: its own radial extent survives.
        const result = body.shape.unchecked()!.boundingBox();
        expect(result.max.y).toBeCloseTo(25, 1);
        expect(result.min.y).toBeCloseTo(-25, 1);
    });

    test("an operation on a revolve that is the first feature surfaces as an error", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;

        const body = new ParametricBodyNode({
            document: doc,
            features: [cylinderRevolve(doc, "cut")],
        });
        doc.modelManager.addNode(body);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Revolve join/cut/intersect requires a preceding feature");
    });
});
