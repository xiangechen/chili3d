// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { ChamferFeatureData, FeatureData } from "../src/features/feature";
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

/** The vertical edge at the (x, y) corner of the plate, as the command would capture it. */
function cornerRef(body: ParametricBodyNode, x: number, y: number) {
    const found = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
        .map((edge, index) => ({ edge, index }))
        .find(({ edge }) => {
            const [s, e] = [edge.startPoint(), edge.endPoint()];
            return (
                Math.abs(s.x - x) < 1e-6 &&
                Math.abs(e.x - x) < 1e-6 &&
                Math.abs(s.y - y) < 1e-6 &&
                Math.abs(e.y - y) < 1e-6 &&
                Math.abs(Math.abs(s.z - e.z) - 20) < 1e-6
            );
        });
    expect(found).toBeDefined();
    const id = body.edgeIdAt(found!.index);
    return captureEdgeRef(found!.edge, id, body.edgeIdIsShared(id));
}

function withChamfer(body: ParametricBodyNode, chamfer: Partial<ChamferFeatureData> & { id: string }) {
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            type: "chamfer",
            distance: 4,
            edges: [cornerRef(body, 20, 20)],
            ...chamfer,
        } as ChamferFeatureData,
    ]);
    return body.featureItems().at(-1)?.error;
}

/**
 * The face the chamfer built at the (20, 20) corner: the only one whose normal has BOTH an
 * x and a y component (every box face is axis-aligned). Read as its bounding-box center.
 */
function chamferCenter(body: ParametricBodyNode): [number, number, number] {
    const face = (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).find((candidate) => {
        const n = candidate.normal(0, 0)[1];
        return Math.abs(n.x) > 1e-6 && Math.abs(n.y) > 1e-6;
    });
    expect(face).toBeDefined();
    const box = face!.boundingBox();
    return [
        round((box.min.x + box.max.x) / 2),
        round((box.min.y + box.max.y) / 2),
        round((box.min.z + box.max.z) / 2),
    ];
}

const volumeOf = (body: ParametricBodyNode) => round(body.shape.unchecked()!.volume());

// A two-distance chamfer on a 20-long edge cuts a triangular prism of legs d1·d2 off the
// 40×40×20 plate: 32000 − ½·4·2·20.
const TWO_DIST_VOLUME = 40 * 40 * 20 - 0.5 * 4 * 2 * 20;

describe("two-distance chamfer (real kernel)", () => {
    test("cuts the corner asymmetrically — d1 on the reference face, d2 on the other", () => {
        const { body } = setup();
        expect(withChamfer(body, { id: "c1", mode: "twoDistance", distance2: 2 })).toBeUndefined();

        expect(volumeOf(body)).toBe(TWO_DIST_VOLUME);
        // The strip's center sits d1/2 off one axis and d2/2 off the other: (4−2)/2 = 1 of
        // asymmetry around the corner diagonal, either way round (the kernel picks which
        // adjacent face is "first"; the sum pins both distances).
        const [cx, cy, cz] = chamferCenter(body);
        expect(round(Math.abs(cx - cy))).toBe(1);
        expect(round(cx + cy)).toBe(37);
        expect(cz).toBe(10);
    });

    test("flip swaps which face d1 is measured on", () => {
        const { body: plain } = setup();
        expect(withChamfer(plain, { id: "c1", mode: "twoDistance", distance2: 2 })).toBeUndefined();
        const { body: flipped } = setup();
        expect(
            withChamfer(flipped, { id: "c1", mode: "twoDistance", distance2: 2, flip: true }),
        ).toBeUndefined();

        expect(volumeOf(flipped)).toBe(volumeOf(plain));
        const [px, py, pz] = chamferCenter(plain);
        expect(chamferCenter(flipped)).toEqual([py, px, pz]);
    });

    test("distance-angle derives d2 as d1·tan(angle)", () => {
        const { body: twoDist } = setup();
        expect(withChamfer(twoDist, { id: "c1", mode: "twoDistance", distance2: 2 })).toBeUndefined();
        const { body: distAngle } = setup();
        const angle = (Math.atan(0.5) * 180) / Math.PI;
        expect(withChamfer(distAngle, { id: "c1", mode: "distanceAngle", angle })).toBeUndefined();

        expect(volumeOf(distAngle)).toBe(volumeOf(twoDist));
        expect(chamferCenter(distAngle)).toEqual(chamferCenter(twoDist));
    });

    test("an absent mode is the equal-distance chamfer, unchanged", () => {
        const { body } = setup();
        expect(withChamfer(body, { id: "c1" })).toBeUndefined();
        expect(volumeOf(body)).toBe(round(40 * 40 * 20 - 0.5 * 4 * 4 * 20));
        expect(chamferCenter(body)).toEqual([18, 18, 10]);
    });

    test.each([
        [{ mode: "bogus" }, "Invalid chamfer mode: bogus"],
        [{ mode: "twoDistance" }, "A two-distance chamfer requires distance2"],
        [{ mode: "distanceAngle" }, "A distance-angle chamfer requires an angle"],
        [{ mode: "distanceAngle", angle: 95 }, "between 0° and 90°"],
        [{ mode: "distanceAngle", angle: 0 }, "between 0° and 90°"],
    ] as const)("hand-edited data %o fails the feature rather than the kernel", (extra, message) => {
        const { body } = setup();
        const error = withChamfer(body, { id: "c1", ...(extra as object) } as never);
        expect(error).toContain(message);
    });

    test("the corner's ids survive an upstream edit", () => {
        const { body } = setup();
        expect(withChamfer(body, { id: "c1", mode: "twoDistance", distance2: 2 })).toBeUndefined();
        const surfaceIds = () =>
            (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).map((_, index) =>
                body.faceIdAt(index),
            );
        const corner = surfaceIds().find((id) => id?.endsWith(":f"));
        expect(corner).toBeDefined();

        // Edit the plate's depth upstream; the chamfer must re-resolve and keep its names.
        body.setFeaturesEmitShapeChanged([
            { ...body.features[0], depth: 25 } as FeatureData,
            body.features[1],
        ]);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        expect(surfaceIds()).toContain(corner);
        expect(volumeOf(body)).toBe(round(40 * 40 * 25 - 0.5 * 4 * 2 * 25));
    });
});
