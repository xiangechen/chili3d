// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { captureBoundaryExternalRefs } from "../src/sketch/commands/sketchCommands";
import { captureExternalRef } from "../src/sketch/externalRef";
import { sketchPlaneOfFace } from "../src/sketch/planeRef";
import {
    ConstraintKind,
    type ExternalRefData,
    FIRST_EXTERNAL_ENTITY_ID,
    type SketchData,
} from "../src/sketch/sketchModel";
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

const rectUV = (u0: number, v0: number, u1: number, v1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [u0, v0, u1, v0] },
        { id: 2, type: "line", params: [u1, v0, u1, v1] },
        { id: 3, type: "line", params: [u1, v1, u0, v1] },
        { id: 4, type: "line", params: [u0, v1, u0, v0] },
    ],
    constraints: [],
});

/**
 * The user's repro: box (e1) → groove cut from the front face (e2) → sketch3 on the
 * groove floor with refs on the groove's edges plus a piece of the groove-split top
 * edge → a pocket cut from sketch3 (e3). Rolling the body back to e1 (what entering
 * sketch2's editor session does) hides e2/e3: the groove's edges are gone and the
 * split top edge is whole again.
 */
function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rectUV(-20, -20, 20, 20) });
    doc.modelManager.addNode(sketch1);
    const frontPlane = new Plane({
        origin: new XYZ({ x: 0, y: -20, z: 0 }),
        normal: new XYZ({ x: 0, y: -1, z: 0 }),
        xvec: XYZ.unitX,
    });
    const sketch2 = new SketchNode({ document: doc, plane: frontPlane, data: rectUV(-10, 12, 10, 20) });
    doc.modelManager.addNode(sketch2);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            { id: "e1", type: "extrude", sketchId: sketch1.id, depth: 20 },
            { id: "e2", type: "extrude", sketchId: sketch2.id, depth: -10, operation: "cut" },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // sketch3 on the groove floor (z = 12), captured like the face-sketch command.
    const faces = body.shape.unchecked()?.findSubShapes(ShapeTypes.face) as IFace[];
    const floor = faces.find((face) => {
        const [point, normal] = face.normal(0, 0);
        return normal.z > 0.9 && Math.abs(point.z - 12) < 1e-6;
    });
    expect(floor).toBeDefined();
    const plane = sketchPlaneOfFace(floor!);
    const capturedRefs = captureBoundaryExternalRefs(
        body,
        { kind: "face", data: { shape: floor!, transform: Matrix4.identity() } as any },
        plane,
    );
    expect(capturedRefs).toBeDefined();
    if (capturedRefs === undefined) throw new Error("boundary refs missing");
    const refs: ExternalRefData[] = capturedRefs;
    expect(refs).toHaveLength(4);

    // A ref on a surviving piece of the groove-split top edge (y=-20, z=20): the
    // split pieces share one tracked id, and on the rolled-back box that id
    // identifies the WHOLE unsplit edge again — resolving there would grow the
    // ref's span onto wrong geometry. On the settled body the exact-span piece
    // wins the shared id (pinned by the bystander test below); the rollback
    // guards must keep that growth from ever resolving — for the bystander, and
    // for the session owner whose anchor the rollback undercuts.
    const bodyEdges = body.shape.unchecked()?.findSubShapes(ShapeTypes.edge) as IEdge[];
    const pieceIndex = bodyEdges.findIndex((edge) => {
        const points = [edge.startPoint(), edge.endPoint()];
        return (
            points.every((p) => Math.abs(p.y + 20) < 1e-6 && Math.abs(p.z - 20) < 1e-6) &&
            Math.abs(Math.min(...points.map((p) => p.x)) + 20) < 1e-6 &&
            Math.abs(Math.max(...points.map((p) => p.x)) + 10) < 1e-6
        );
    });
    expect(pieceIndex).toBeGreaterThanOrEqual(0);
    const pieceRef = captureExternalRef(
        FIRST_EXTERNAL_ENTITY_ID - refs.length,
        body.id,
        plane,
        bodyEdges[pieceIndex],
        body.edgeIdAt(pieceIndex),
        "reference",
    );
    expect(pieceRef).toBeDefined();
    const allRefs = [...refs, pieceRef!];

    // The floor boundary in the sketch plane's UV (the off-plane piece ref would
    // stretch the bounds), inset for sketch3's own profile.
    const us = refs.flatMap((ref) => [ref.snapshot[0], ref.snapshot[2]]);
    const vs = refs.flatMap((ref) => [ref.snapshot[1], ref.snapshot[3]]);
    const [uMin, uMax] = [Math.min(...us), Math.max(...us)];
    const [vMin, vMax] = [Math.min(...vs), Math.max(...vs)];

    // One line start pinned to a floor corner ref, so a ref move drags the sketch.
    const leftRef = refs.find((ref) => Math.abs(ref.snapshot[0] - uMin) < 1e-9);
    expect(leftRef).toBeDefined();
    const data: SketchData = {
        entities: [
            ...rectUV(uMin + 2, vMin + 2, uMax - 2, vMax - 2).entities,
            { id: 5, type: "line", params: [uMin, vMin, uMin + 3, vMin + 3] },
        ],
        constraints: [
            {
                id: 1,
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 5, pointIndex: 0 },
                    { entityId: leftRef!.entityId, pointIndex: 0 },
                ],
            },
        ],
        externalRefs: allRefs,
        refPositions: { [body.id]: 2 },
    };
    const sketch3 = new SketchNode({
        document: doc,
        plane,
        planeRef: {
            nodeId: body.id,
            normal: { x: 0, y: 0, z: 1 },
            offset: 12,
            faceId: body.faceIdAt(faces.indexOf(floor!)),
        },
        data,
    });
    doc.modelManager.addNode(sketch3);
    expect(sketch3.shape.isOk).toBe(true);

    // e3: the pocket cut consuming sketch3, like the user's second 移除 extrude.
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id: "e3", type: "extrude", sketchId: sketch3.id, depth: -3, operation: "cut" },
    ]);
    expect(body.features).toHaveLength(3);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    expect(sketch3.shape.isOk).toBe(true);

    return { doc, body, sketch3, pieceEntityId: pieceRef!.entityId };
}

test("a bystander sketch ignores the body's session-rollback shape", () => {
    const { body, sketch3, pieceEntityId } = setup();
    // The piece ref kept its captured span on the settled body: the shared id is
    // claimed by the exact-span piece, not by a first-hit sibling.
    const piece = sketch3.data.externalRefs?.find((ref) => ref.entityId === pieceEntityId);
    expect(piece).toBeDefined();
    for (const [index, expected] of [-20, -20, -10, -20].entries()) {
        expect(piece!.snapshot[index]).toBeCloseTo(expected, 6);
    }
    const settledJson = sketch3.dataJson;
    const settledPlaneZ = sketch3.plane.origin.z;
    expect(settledPlaneZ).toBeCloseTo(12, 6);

    // Entering sketch2's editor rolls the body back to index 1 (groove hidden).
    expect(body.setRollbackIndex(1)).toBe(true);
    expect(body.rollbackIndex).toBe(1);

    // sketch3 is NOT the session owner: its refs, entities and plane must stay
    // exactly as they were — the rolled-back shape is a transient preview.
    expect(sketch3.dataJson).toBe(settledJson);
    expect(sketch3.plane.origin.z).toBeCloseTo(settledPlaneZ, 6);
    expect(sketch3.shape.isOk).toBe(true);

    // Restoring the full chain leaves the settled sketch untouched as well.
    expect(body.setRollbackIndex(undefined)).toBe(true);
    expect(sketch3.dataJson).toBe(settledJson);
    expect(sketch3.plane.origin.z).toBeCloseTo(settledPlaneZ, 6);
});

test("a rollback undercutting the sketch's anchor freezes the session owner's refs too", () => {
    const { body, sketch3, pieceEntityId } = setup();
    const settledJson = sketch3.dataJson;
    const piece = () => sketch3.data.externalRefs?.find((ref) => ref.entityId === pieceEntityId);

    // Same rollback, but with sketch3 owning the session: its anchor on the body
    // is 2 while the rollback sits at 1 — a propagated rollback does this (the
    // body boolean-consuming another rolled-back body). The anchor's timeline
    // state is unreachable: the truncated replay stops at 1 and the preview shows
    // an EARLIER state than capture time. Resolving there would dangle the
    // groove-floor refs (the groove is hidden) and grow the piece ref onto the
    // whole unsplit top edge — persisting both corruptions until the session
    // ends — so even the session owner's refs freeze, exactly like a bystander's.
    sketch3.setEditingSession(true);
    expect(body.setRollbackIndex(1)).toBe(true);

    expect(sketch3.dataJson).toBe(settledJson);
    for (const [index, expected] of [-20, -20, -10, -20].entries()) {
        expect(piece()!.snapshot[index]).toBeCloseTo(expected, 6);
    }
    expect(sketch3.data.externalRefs!.every((ref) => ref.dangling !== true)).toBe(true);
    expect(sketch3.shape.isOk).toBe(true);
    // The plane reference freezes the same way: the captured groove floor is
    // hidden at rollback 1, so resolving would hop the plane to the box top (z=20).
    expect(sketch3.plane.origin.z).toBeCloseTo(12, 6);

    // Restoring the full chain resolves normally again — nothing needed healing.
    expect(body.setRollbackIndex(undefined)).toBe(true);
    expect(sketch3.dataJson).toBe(settledJson);
    for (const [index, expected] of [-20, -20, -10, -20].entries()) {
        expect(piece()!.snapshot[index]).toBeCloseTo(expected, 6);
    }
    expect(sketch3.data.externalRefs!.every((ref) => ref.dangling !== true)).toBe(true);
    expect(sketch3.plane.origin.z).toBeCloseTo(12, 6);
    sketch3.setEditingSession(false);
});

test("a bystander body does not re-evaluate against a rolled-back source", () => {
    const { doc, body } = setup();

    // A bystander body press-pulling a face of `body` — its feature watches the source.
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const topIndex = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
    expect(topIndex).toBeGreaterThanOrEqual(0);
    const ref = captureProfileRef(faces[topIndex], body.faceIdAt(topIndex));
    const bystander = new ParametricBodyNode({
        document: doc,
        features: [{ id: "p1", type: "extrude", depth: 5, source: { nodeId: body.id, profiles: [ref] } }],
    });
    doc.modelManager.addNode(bystander);
    expect(bystander.shape.isOk).toBe(true);
    const settledShape = bystander.shape;
    const settledJson = bystander.featuresJson;

    // Rolling the source back notifies the bystander — it must NOT rebuild against
    // the preview: the rebuilt shape would miss the hidden features' geometry and
    // the run would re-anchor (and persist) refs onto it.
    expect(body.setRollbackIndex(1)).toBe(true);
    expect(bystander.shape).toBe(settledShape);
    expect(bystander.featuresJson).toBe(settledJson);
    expect(bystander.featureItems().map((x) => x.error)).toEqual([undefined]);

    // Restoring notifies again (the flag is cleared first), and the rebuild works
    // on the full-chain geometry without having touched the persisted refs.
    expect(body.setRollbackIndex(undefined)).toBe(true);
    expect(bystander.shape.isOk).toBe(true);
    expect(bystander.featureItems().map((x) => x.error)).toEqual([undefined]);
    expect(bystander.featuresJson).toBe(settledJson);
});
