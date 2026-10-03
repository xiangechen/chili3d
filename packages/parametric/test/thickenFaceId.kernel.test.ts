// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { FilletFeatureData, ThickenFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";

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

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** The body's faces grouped by height: every distinct z with the total area at that z. */
function heights(body: ParametricBodyNode): { z: number; area: number }[] {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const byZ = new Map<number, number>();
    for (const face of faces) {
        if (face.normal(0, 0)[1].z < 1 - 1e-6) continue;
        const z = round(face.boundingBox().min.z);
        byZ.set(z, (byZ.get(z) ?? 0) + round(face.area()));
    }
    return [...byZ.entries()].map(([z, area]) => ({ z, area })).sort((a, b) => a.z - b.z);
}

/** A 40×40 plate extruded 20 up, plus the box top face's fingerprint — the thicken's source. */
function buildBody(feature: (source: ThickenFeatureData["source"]) => ThickenFeatureData) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, -20, 20, 20) });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 20,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);

    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const topIndex = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
    const source = {
        nodeId: body.id,
        profiles: [captureProfileRef(faces[topIndex], body.faceIdAt(topIndex))],
    };
    body.setFeaturesEmitShapeChanged([...body.features, feature(source)]);
    return body;
}

const setThickness = (body: ParametricBodyNode, thickness: number): void => {
    body.setFeaturesEmitShapeChanged(body.features.map((f) => (f.id === "t1" ? { ...f, thickness } : f)));
};

const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);

describe("thicken", () => {
    test("a join stands material on the source face, and a thickness edit rebuilds cleanly", () => {
        const body = buildBody((source) => ({
            id: "t1",
            type: "thicken",
            source,
            thickness: 5,
            operation: "fuse",
        }));

        expect(errors(body)).toEqual([undefined, undefined]);
        // The 40×40 plate grew by 5 on top of its z = 20 face.
        expect(heights(body)).toEqual([{ z: 25, area: 1600 }]);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 25);

        setThickness(body, 10);
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(heights(body)).toEqual([{ z: 30, area: 1600 }]);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 30);
    });

    test("midplane straddles the face, so a cut takes half the width out of the body", () => {
        const body = buildBody((source) => ({
            id: "t1",
            type: "thicken",
            source,
            thickness: 10,
            midplane: true,
            operation: "cut",
        }));

        expect(errors(body)).toEqual([undefined, undefined]);
        // The 10mm band spans z = 15..25; the cut leaves the plate 15 tall.
        expect(heights(body)).toEqual([{ z: 15, area: 1600 }]);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 15);
    });

    test("the second thickness reaches to the far side, and reverse swaps which side that is", () => {
        const body = buildBody((source) => ({
            id: "t1",
            type: "thicken",
            source,
            thickness: 5,
            reverse: true,
            thickness2: 3,
            operation: "fuse",
        }));

        expect(errors(body)).toEqual([undefined, undefined]);
        // Reversed: 5 reaches down from z = 20 (all inside the plate, so the union is
        // unchanged) and 3 reaches up — the top lands at z = 23.
        expect(heights(body)).toEqual([{ z: 23, area: 1600 }]);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 23);
    });

    test("the thickened geometry keeps tracked ids, and a fillet on it survives a thickness edit", () => {
        const body = buildBody((source) => ({
            id: "t1",
            type: "thicken",
            source,
            thickness: 5,
            operation: "fuse",
        }));
        expect(body.hasTrackedIds("edge")).toBe(true);

        // Every edge of the thickened wall is named — the rim's vertical corner edges included,
        // which the kernel reports no history for at all.
        const unnamed = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[]).filter(
            (_, index) => body.edgeIdAt(index) === undefined,
        );
        expect(unnamed).toHaveLength(0);

        // Round the top's rim, then deepen the thicken under it: the fillet's ref has to keep
        // resolving by id (a loss is a test failure, see `test/setup.ts`).
        const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
        const rimIndex = edges.findIndex(
            (edge) => edge.startPoint().z > 20 - 1e-6 && edge.endPoint().z > 20 - 1e-6,
        );
        const fillet: FilletFeatureData = {
            id: "f1",
            type: "fillet",
            radius: 2,
            edges: [captureEdgeRef(edges[rimIndex], body.edgeIdAt(rimIndex))],
        };
        body.setFeaturesEmitShapeChanged([...body.features, fillet]);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        expect(body.featureItems()[2].error).toBeUndefined();

        setThickness(body, 8);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        // The top moved up by the 3mm the thicken grew; the fillet rounds one of its rim
        // edges, so its area is short of the full 40×40.
        const top = heights(body);
        expect(top).toHaveLength(1);
        expect(top[0].z).toBe(28);
        expect(top[0].area).toBeLessThan(1600);
        const healed = body.features[2];
        expect(healed.type === "fillet" ? typeof healed.edges[0]?.edgeId : undefined).toBe("string");
    });
});
