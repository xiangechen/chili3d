// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The sketch plane must follow its source face MID-CHAIN, anchored at the
 * sketch's timeline position — not only on the source's post-chain shape
 * notification. Repro: box from sketch1, side-face sketch2 (planeRef + boundary
 * refs) cutting a groove, the groove ceiling press-pulled; shrinking sketch1's
 * rectangle so the side face slides ALONG THE PLANE NORMAL used to fail with
 * "Face not found after rebuild". The ref edge's UV snapshot is blind to that
 * motion, so without the mid-chain plane follow the sketch regenerated at its
 * stale world position, the groove cut turned into a no-op, the press-pull lost
 * its face, the chain failed — and with no shape change emitted, the plane watch
 * never fired either (wedged for good).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Matrix4, Plane, ShapeTypes, Transaction, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { ExtrudeFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { captureBoundaryExternalRefs } from "../src/sketch/commands/sketchCommands";
import { captureFaceRef, sketchPlaneOfFace } from "../src/sketch/planeRef";
import { ConstraintKind, type SketchData } from "../src/sketch/sketchModel";
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

const rect = (x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [0, 0, x1, 0] },
        { id: 2, type: "line", params: [x1, 0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, 0, y1] },
        { id: 4, type: "line", params: [0, y1, 0, 0] },
    ],
    constraints: [],
});

interface Setup {
    doc: TestDocument;
    body: ParametricBodyNode;
    sketch1: SketchNode;
    sketch2: SketchNode;
}

/** Box w×h×40 from sketch1, side-face groove 15 deep from sketch2, ceiling pressed +5. */
function build(w: number, h: number): Setup {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rect(w, h) });
    doc.modelManager.addNode(sketch1);
    const profiles1 = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch1.id,
                depth: 40,
                profiles: [captureProfileRef(profiles1[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    const bodyFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const sideIndex = bodyFaces.findIndex((face) => face.normal(0, 0)[1].x > 1 - 1e-6);
    expect(sideIndex).toBeGreaterThanOrEqual(0);
    const side = bodyFaces[sideIndex];
    const plane = sketchPlaneOfFace(side);
    const planeRef = { ...captureFaceRef(body.id, side), faceId: body.faceIdAt(sideIndex) };
    const refs = captureBoundaryExternalRefs(
        body,
        { kind: "face", data: { shape: side, transform: Matrix4.identity() } } as any,
        plane,
    );
    expect(refs).toHaveLength(4);
    const leftRef = refs!.find(
        (ref) =>
            Math.abs(ref.snapshot[0]) < 1e-9 &&
            Math.abs(ref.snapshot[2]) < 1e-9 &&
            Math.abs(ref.snapshot[1] - ref.snapshot[3]) > 1e-6,
    );
    expect(leftRef).toBeDefined();
    (leftRef as { role: string }).role = "profile";

    const sketch2 = new SketchNode({
        document: doc,
        plane,
        planeRef,
        data: {
            entities: [
                { id: 1, type: "line", params: [0, 10, 20, 10] },
                { id: 2, type: "line", params: [20, 10, 20, 25] },
                { id: 3, type: "line", params: [20, 25, 0, 25] },
                { id: 4, type: "line", params: [0, 25, 0, 10] },
            ],
            constraints: [
                {
                    id: 1,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 1, pointIndex: 1 },
                        { entityId: 2, pointIndex: 0 },
                    ],
                },
                {
                    id: 2,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 2, pointIndex: 1 },
                        { entityId: 3, pointIndex: 0 },
                    ],
                },
                {
                    id: 3,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 3, pointIndex: 1 },
                        { entityId: 4, pointIndex: 0 },
                    ],
                },
                {
                    id: 4,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 4, pointIndex: 1 },
                        { entityId: 1, pointIndex: 0 },
                    ],
                },
                {
                    id: 5,
                    kind: ConstraintKind.PointOnLine,
                    refs: [
                        { entityId: 4, pointIndex: 0 },
                        { entityId: leftRef!.entityId, pointIndex: 0 },
                        { entityId: leftRef!.entityId, pointIndex: 1 },
                    ],
                },
                {
                    id: 6,
                    kind: ConstraintKind.PointOnLine,
                    refs: [
                        { entityId: 4, pointIndex: 1 },
                        { entityId: leftRef!.entityId, pointIndex: 0 },
                        { entityId: leftRef!.entityId, pointIndex: 1 },
                    ],
                },
            ],
            externalRefs: refs,
            refPositions: { [body.id]: 1 },
        },
    });
    doc.modelManager.addNode(sketch2);
    expect(sketch2.shape.isOk).toBe(true);

    const profiles2 = sketch2.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(profiles2.length).toBe(1);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            sketchId: sketch2.id,
            depth: -15,
            operation: "cut",
            profiles: [captureProfileRef(profiles2[0].shape as unknown as IFace)],
        },
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const index = faces.findIndex((face) => {
        const [point, normal] = face.normal(0, 0);
        return normal.z < -1 + 1e-6 && Math.abs(point.z - 25) < 1e-6;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    const id = body.faceIdAt(index);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e3",
            type: "extrude",
            depth: 5,
            operation: "fuse",
            source: {
                nodeId: body.id,
                profiles: [captureProfileRef(faces[index], id, body.faceIdIsShared(id), true)],
            },
        } as ExtrudeFeatureData,
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    return { doc, body, sketch1, sketch2 };
}

const errors = (body: ParametricBodyNode): (string | undefined)[] => body.featureItems().map((x) => x.error);

test("sketch1 rectangle edits keep the groove and the pressed ceiling at every size", () => {
    for (const [w, h] of [
        [50, 40],
        [30, 40],
        [40, 50],
        [40, 30],
        [40, 15],
        [50, 50],
        [20, 40],
    ]) {
        const { body, sketch1, sketch2 } = build(40, 40);
        sketch1.setDataEmitShapeChanged(rect(w, h));
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        // The plane followed the side face (its origin is the world origin
        // projected onto the face plane); the body geometry is the fresh-build one.
        expect(sketch2.plane.origin.x).toBeCloseTo(w);
        expect(sketch2.plane.origin.y).toBeCloseTo(0);
        expect(sketch2.plane.normal.isEqualTo(XYZ.unitX)).toBe(true);
        const bbox = body.shape.unchecked()!.boundingBox();
        expect(bbox.min.x).toBeCloseTo(0);
        expect(bbox.max.x).toBeCloseTo(w);
        expect(bbox.max.y).toBeCloseTo(h);
    }
});

test("the 40→20 edit produces the fresh-build geometry (plane followed mid-chain)", () => {
    const edited = build(40, 40);
    edited.sketch1.setDataEmitShapeChanged(rect(20, 40));
    expect(errors(edited.body)).toEqual([undefined, undefined, undefined]);
    expect(edited.sketch2.plane.origin.x).toBeCloseTo(20);

    const fresh = build(20, 40);
    const editedShape = edited.body.shape.unchecked()!;
    const freshShape = fresh.body.shape.unchecked()!;
    expect(editedShape.findSubShapes(ShapeTypes.face).length).toBe(
        freshShape.findSubShapes(ShapeTypes.face).length,
    );
    expect(editedShape.findSubShapes(ShapeTypes.edge).length).toBe(
        freshShape.findSubShapes(ShapeTypes.edge).length,
    );
    const editedBox = editedShape.boundingBox();
    const freshBox = freshShape.boundingBox();
    expect(editedBox.max.x).toBeCloseTo(freshBox.max.x);
    expect(editedBox.max.y).toBeCloseTo(freshBox.max.y);
    expect(editedBox.max.z).toBeCloseTo(freshBox.max.z);
});

test("undoing the edit restores the plane through the same resolution", () => {
    const { doc, body, sketch1, sketch2 } = build(40, 40);
    // App gestures run inside an explicit transaction, so one undo replays the
    // whole edit — including the cascade it triggered.
    Transaction.execute(doc, "edit sketch1", () => sketch1.setDataEmitShapeChanged(rect(20, 40)));
    expect(sketch2.plane.origin.x).toBeCloseTo(20);
    doc.history.undo();
    expect(errors(body)).toEqual([undefined, undefined, undefined]);
    expect(sketch2.plane.origin.x).toBeCloseTo(40);
    const bbox = body.shape.unchecked()!.boundingBox();
    expect(bbox.max.x).toBeCloseTo(40);
});
