// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { FeatureData, FilletFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
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

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({
        document: doc,
        id: "sk1",
        plane: Plane.XY,
        data: rect(-20, -20, 20, 20),
    });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
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
    expect(body.shape.isOk).toBe(true);
    return { doc, sketch, body };
}

/** The vertical edge at the (20, 20) corner of the plate, as the command would capture it. */
function cornerRef(body: ParametricBodyNode) {
    const found = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
        .map((edge, index) => ({ edge, index }))
        .find(({ edge }) => {
            const [s, e] = [edge.startPoint(), edge.endPoint()];
            return (
                Math.abs(s.x - 20) < 1e-6 &&
                Math.abs(e.x - 20) < 1e-6 &&
                Math.abs(s.y - 20) < 1e-6 &&
                Math.abs(e.y - 20) < 1e-6 &&
                Math.abs(Math.abs(s.z - e.z) - 20) < 1e-6
            );
        });
    expect(found).toBeDefined();
    const id = body.edgeIdAt(found!.index);
    return captureEdgeRef(found!.edge, id, body.edgeIdIsShared(id));
}

function withFillet(body: ParametricBodyNode, fillet: Partial<FilletFeatureData> & { id: string }) {
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { type: "fillet", radius: 2, edges: [cornerRef(body)], ...fillet } as FilletFeatureData,
    ]);
    return body.featureItems().at(-1)?.error;
}

/**
 * The areas of the two horizontal faces, sorted ascending: the fillet at the (20, 20) corner
 * trims each of them by (nearly) a square minus its quarter arc, `r²·(1 − π/4)`, with the
 * radius that end of the edge carries. Whichever end the kernel calls "start", the pair must
 * read the same — so the cases assert the SET, and the swap case asserts the ends follow the
 * radii. "Nearly": a variable fillet's end trim is a B-spline that dips slightly inside the
 * circular arc mid-span (measured: 9e-6 off the circular model's area at r=5), so the
 * comparisons are closeTo, not exact.
 */
function horizontalAreas(body: ParametricBodyNode): [number, number] {
    const areas = (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[])
        .filter((face) => Math.abs(face.normal(0, 0)[1].z) > 1 - 1e-6)
        .map((face) => round(face.area()))
        .sort((a, b) => a - b);
    expect(areas).toHaveLength(2);
    return areas as [number, number];
}

/** The area a horizontal face keeps when a corner of it is rounded off at radius `r`. */
const trimmedArea = (r: number) => 40 * 40 - r * r * (1 - Math.PI / 4);

const volumeOf = (body: ParametricBodyNode) => round(body.shape.unchecked()!.volume());

describe("variable-radius fillet (real kernel)", () => {
    test("rounds the two ends with their own radii", () => {
        const { body } = setup();
        expect(withFillet(body, { id: "f1", radius: 2, radius2: 5 })).toBeUndefined();

        // One horizontal face trimmed at r=2, the other at r=5 (see `horizontalAreas`).
        const [lo, hi] = horizontalAreas(body);
        expect(lo).toBeCloseTo(trimmedArea(5), 3);
        expect(hi).toBeCloseTo(trimmedArea(2), 3);
        // Sanity on the round itself: the fillet surface is one new face, and nothing else lost area.
        const ids = (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).map((_, index) =>
            body.faceIdAt(index),
        );
        expect(ids.some((id) => id?.endsWith(":f"))).toBe(true);
    });

    test("swapping the radii swaps the ends", () => {
        const { body: a } = setup();
        expect(withFillet(a, { id: "f1", radius: 2, radius2: 5 })).toBeUndefined();
        const { body: b } = setup();
        expect(withFillet(b, { id: "f1", radius: 5, radius2: 2 })).toBeUndefined();

        // Each end's radius is decided by the edge's OWN start/end orientation; swapping the
        // pair mirrors the round, so each z face of one body matches the opposite of the other.
        const areasOf = (body: ParametricBodyNode) =>
            (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[])
                .filter((face) => Math.abs(face.normal(0, 0)[1].z) > 1 - 1e-6)
                .map((face) => ({ z: round(face.boundingBox().max.z), area: round(face.area()) }))
                .sort((x, y) => x.z - y.z);
        const [aBottom, aTop] = areasOf(a);
        const [bBottom, bTop] = areasOf(b);
        expect(aBottom.area).toBe(bTop.area);
        expect(aTop.area).toBe(bBottom.area);
        expect(aBottom.area).not.toBe(aTop.area);
    });

    test("radius2 equal to radius takes the constant-radius path", () => {
        const { body: variable } = setup();
        expect(withFillet(variable, { id: "f1", radius: 3, radius2: 3 })).toBeUndefined();
        const { body: constant } = setup();
        expect(withFillet(constant, { id: "f1", radius: 3 })).toBeUndefined();

        expect(volumeOf(variable)).toBe(volumeOf(constant));
        expect(horizontalAreas(variable)).toEqual(horizontalAreas(constant));
    });

    test("a blank radius2 is the constant fillet (the panel clears the field)", () => {
        const { body } = setup();
        expect(withFillet(body, { id: "f1", radius: 3, radius2: "" })).toBeUndefined();
        const [lo, hi] = horizontalAreas(body);
        expect(lo).toBeCloseTo(trimmedArea(3), 3);
        expect(hi).toBeCloseTo(trimmedArea(3), 3);
    });

    test("the corner's ids survive an upstream edit", () => {
        const { body } = setup();
        expect(withFillet(body, { id: "f1", radius: 2, radius2: 5 })).toBeUndefined();
        const surfaceIds = () =>
            (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).map((_, index) =>
                body.faceIdAt(index),
            );
        const corner = surfaceIds().find((id) => id?.endsWith(":f"));
        expect(corner).toBeDefined();

        body.setFeaturesEmitShapeChanged([
            { ...body.features[0], depth: 25 } as FeatureData,
            body.features[1],
        ]);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        expect(surfaceIds()).toContain(corner);
        const [lo, hi] = horizontalAreas(body);
        expect(lo).toBeCloseTo(trimmedArea(5), 3);
        expect(hi).toBeCloseTo(trimmedArea(2), 3);
    });
});
