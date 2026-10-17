// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Matrix4, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { SplitFeatureData } from "../src/features/feature";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";
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

const BOX_VOLUME = 40 * 40 * 20;

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

/** A 40×40×20 box centred on the XY origin; the ZX datum (normal +Y) halves it. */
function setup(extra?: Partial<SplitFeatureData>, transform?: Matrix4) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({
        document: doc,
        id: "sk1",
        plane: Plane.XY,
        data: rect(-20, -20, 20, 20),
    });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 20 }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    // A transform alone does not re-run the chain (it is normally local-space invariant);
    // the feature append right after is what rebuilds against it.
    if (transform !== undefined) body.transform = transform;
    const feature: SplitFeatureData = {
        id: "s1",
        type: "split",
        tool: { kind: "datum", name: "ZX" },
        ...extra,
    };
    body.setFeaturesEmitShapeChanged([...body.features, feature]);
    return { doc, sketch, body };
}

describe("split feature", () => {
    test("keepSide both keeps two halves whose volumes sum to the box", () => {
        const { body } = setup();
        expect(body.shape.isOk).toBe(true);
        const shape = body.shape.unchecked()!;
        expect(shape.findSubShapes(ShapeTypes.solid).length).toBe(2);
        expect(shape.volume()).toBeCloseTo(BOX_VOLUME, 3);
    });

    test("positive keeps the half on the plane normal's side", () => {
        const { body } = setup({ keepSide: "positive" });
        const shape = body.shape.unchecked()!;
        expect(shape.volume()).toBeCloseTo(BOX_VOLUME / 2, 3);
        expect(shape.boundingBox().min.y).toBeGreaterThan(-1e-6);
    });

    test("negative keeps the opposite half", () => {
        const { body } = setup({ keepSide: "negative" });
        const shape = body.shape.unchecked()!;
        expect(shape.volume()).toBeCloseTo(BOX_VOLUME / 2, 3);
        expect(shape.boundingBox().max.y).toBeLessThan(1e-6);
    });

    test("a kept side nothing sits on is an error, not a silent empty", () => {
        // The whole box sits on the datum's positive side; the negative half is empty.
        // The failed feature keeps the last good shape and reports on the row.
        const { body } = setup({ keepSide: "negative" }, Matrix4.fromTranslation(0, 100, 0));
        expect(body.featureItems()[1].error).toContain("nothing remains on the kept side");
    });

    test("the split reports no tracked ids — references degrade to geometric matching", () => {
        const { body } = setup();
        expect(body.shape.isOk).toBe(true);
        expect(body.faceIdAt(0)).toBeUndefined();

        // A rebuild after an upstream parameter edit still evaluates the split cleanly.
        body.setFeatureParameter("e1", "depth", 30);
        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(40 * 40 * 30, 3);
    });

    test("a hand-written invalid keepSide is a rebuild error", () => {
        const { body } = setup({ keepSide: "sideways" as never });
        expect(body.featureItems()[1].error).toBe("Invalid keep side: sideways");
    });

    test("split as the first feature requires a preceding feature", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [{ id: "s1", type: "split", tool: { kind: "datum", name: "ZX" } }],
        });
        doc.modelManager.addNode(body);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Split requires a preceding feature");
    });
});
