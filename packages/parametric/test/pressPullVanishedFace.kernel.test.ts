// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Regression suite for the consumed press-pull face bug: a groove whose ceiling
 * was press-pulled, then the base extrude is shortened past the groove — the cut
 * consumes the pressed face. The ref's tracked id dies with it, and the geometric
 * fallback used to adopt a stranger: the groove's floor and back wall tie the
 * ceiling's edge fingerprint ("Sketch profile match is ambiguous after rebuild",
 * the user-reported failure), and at some depths the box bottom or the floor WON
 * outright — the press silently swept the WRONG face. Two guards now keep the
 * fallback honest:
 *
 * - `ProfileRef.normal` (captured on source-face picks and re-anchors): a planar
 *   face's outward normal survives rigid moves, so candidates facing more than
 *   60° away (the floor, the walls) are not the moved face;
 * - a ref whose tracked id died competes only for faces WITHOUT a live id of
 *   their own — an id-carrying face has an identity already (the box bottom),
 *   and adopting it sweeps a stranger.
 *
 * The consumed face now fails loudly and accurately: "Face not found after
 * rebuild" (face-worded, not the sketch-flavored fallback message), the stored
 * ref is NOT re-anchored onto a wrong face, and restoring the depth self-heals.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Matrix4, Plane, Serializer, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { ExtrudeFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { captureBoundaryExternalRefs } from "../src/sketch/commands/sketchCommands";
import { sketchPlaneOfFace } from "../src/sketch/planeRef";
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

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

function errors(body: ParametricBodyNode): (string | undefined)[] {
    return body.featureItems().map((x) => x.error);
}

function e3Ref(body: ParametricBodyNode) {
    const e3 = body.features.find((f) => f.id === "e3") as ExtrudeFeatureData;
    return e3.source?.profiles[0];
}

/**
 * The user's scenario: a 40×40×40 box (sketch1 → e1); a rect on the x=40 side
 * face spanning u∈[0,20], v∈[10,25] with its left edge ON the face's front
 * vertical edge (auto-constrained → that boundary ref is profile-role); cut 15
 * inward (e2) → a side-opening groove with a down-facing ceiling at z=25; then a
 * press-pull on the ceiling (e3, swept 5 along its normal, fuse or cut).
 */
function buildGrooveWithCeilingPress(operation: "fuse" | "cut"): ParametricBodyNode {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 40) });
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

    const side = (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).find(
        (face) => face.normal(0, 0)[1].x > 1 - 1e-6,
    );
    expect(side).toBeDefined();
    const plane = sketchPlaneOfFace(side!);
    const refs = captureBoundaryExternalRefs(
        body,
        { kind: "face", data: { shape: side!, transform: Matrix4.identity() } } as any,
        plane,
    );
    expect(refs).toHaveLength(4);
    // The front vertical edge ref (u = 0): the editor's auto-constraints snapped
    // the rect's left line onto it, deriving its role to profile.
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
    expect(errors(body)).toEqual([undefined, undefined]);

    // The groove ceiling: the down-facing face at z=25, pressed 5 along its normal.
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
            operation,
            source: {
                nodeId: body.id,
                profiles: [captureProfileRef(faces[index], id, body.faceIdIsShared(id), true)],
            },
        } as ExtrudeFeatureData,
    ]);
    expect(errors(body)).toEqual([undefined, undefined, undefined]);
    return body;
}

function editDepth(body: ParametricBodyNode, depth: number): void {
    const e1 = body.features.find((f) => f.id === "e1") as ExtrudeFeatureData;
    body.setFeaturesEmitShapeChanged([{ ...e1, depth }, ...body.features.slice(1)]);
}

describe.each([
    { operation: "fuse" as const },
    { operation: "cut" as const },
])("a press-pulled groove ceiling, base extrude edited ($operation)", ({ operation }) => {
    test("normal edits keep working while the pressed face exists", () => {
        const body = buildGrooveWithCeilingPress(operation);
        editDepth(body, 50);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        editDepth(body, 30);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        // The pressed ceiling is still at z=25 with its tracked id.
        expect(e3Ref(body)?.id).toContain(":ent3");
        expect(e3Ref(body)?.normal?.z).toBeCloseTo(-1, 6);
    });

    test("consuming the pressed face fails as not-found, never adopts a stranger", () => {
        const body = buildGrooveWithCeilingPress(operation);
        const refBefore = e3Ref(body);
        expect(refBefore?.normal?.z).toBeCloseTo(-1, 6);

        // Box top at z=20 < the ceiling's z=25: the cut consumes the ceiling.
        // Used to fail "Sketch profile match is ambiguous after rebuild" (the
        // groove floor and back wall tie the ceiling's fingerprint).
        editDepth(body, 20);
        expect(errors(body)).toEqual([undefined, undefined, "Face not found after rebuild"]);
        // The stored ref was NOT re-anchored onto a wrong face...
        expect(e3Ref(body)).toEqual(refBefore);

        // ...so restoring the depth self-heals.
        editDepth(body, 40);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        expect(e3Ref(body)?.id).toContain(":ent3");
    });

    test("no depth silently sweeps the floor or the box bottom", () => {
        // Depth 15 used to adopt the groove FLOOR outright (score ratio past
        // the clear-winner margin) and press it — no error at all; the box
        // bottom (same -z normal, same edge count) is the next stranger.
        for (const depth of [25, 24, 20, 15, 10]) {
            const body = buildGrooveWithCeilingPress(operation);
            editDepth(body, depth);
            expect(errors(body)).toEqual([undefined, undefined, "Face not found after rebuild"]);
        }
    });

    test("the pick-time normal round-trips through the Serializer", () => {
        const body = buildGrooveWithCeilingPress(operation);
        expect(e3Ref(body)?.normal?.z).toBeCloseTo(-1, 6);

        const restored = Serializer.deserializeObject(
            body.document,
            Serializer.serializeObject(body),
        ) as ParametricBodyNode;
        const e3 = restored.features.find((f) => f.id === "e3") as ExtrudeFeatureData;
        expect(e3.source?.profiles[0].normal?.z).toBeCloseTo(-1, 6);
    });
});
