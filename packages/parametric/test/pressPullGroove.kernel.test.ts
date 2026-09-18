// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Regression suite for the groove press-pull bug: cutting a groove into a box and
 * press-pulling ONE face of the groove must not pull another face along.
 *
 *   1. rectangle sketch → extrude → 40×40×40 box;
 *   2. rectangle sketch on a SIDE face → extrude with operation "cut" → groove;
 *   3. press-pull (face-source extrude) ONE face of the groove.
 *
 * Root cause: when the cut splits an existing face into pieces, the pieces share one
 * tracked id, and `matchSourceFaceIndexes` adopted EVERY id-overlapping face — one
 * pick on a piece swept its siblings too. The root fix mirrors `EdgeRef.splitPiece`
 * on `ProfileRef`: a pick whose id is already shared at capture time is stamped
 * `splitPiece` (the press-pull command), and `narrowToPickedPiece` (sourceFaceMatcher.ts)
 * never
 * widens such a ref — exactly one fingerprint-exact piece claims it, a stale
 * fingerprint adopts the clear nearest piece, and a tie fails "Face match is
 * ambiguous after rebuild". Legacy refs without the flag keep whole-span adoption.
 *
 * - (a) blind pocket: the pocket's faces carry pairwise distinct ids, so one pick
 *   claims one face — control, never reproduced.
 * - (b1) open step spanning the full side width: the top is truncated to one piece
 *   and the groove floor is tool-born with its own id — control, never reproduced.
 * - (b2) open slot through the box: the cut splits the top face into two pieces
 *   sharing one id — the bug's geometry. The fix pins: only the picked piece is
 *   swept, the flag survives re-anchoring and rebuilds, a stale fingerprint adopts
 *   the clear nearest piece instead of widening, a mirror-symmetric stale
 *   fingerprint fails ambiguous, and a flag-less legacy ref keeps the whole span.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, Serializer, ShapeTypes, XYZ, type XYZLike } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureProfileRef, type ProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { sketchPlaneOfFace } from "../src/sketch/planeRef";
import { type SketchData, toUV } from "../src/sketch/sketchModel";
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

function sketchOnFace(doc: TestDocument, face: IFace, corners: XYZ[]): SketchNode {
    const plane = sketchPlaneOfFace(face);
    const uv = corners.map((p) => toUV(plane, p));
    return new SketchNode({
        document: doc,
        plane,
        data: {
            entities: [
                { id: 1, type: "line", params: [...uv[0], ...uv[1]] },
                { id: 2, type: "line", params: [...uv[1], ...uv[2]] },
                { id: 3, type: "line", params: [...uv[2], ...uv[3]] },
                { id: 4, type: "line", params: [...uv[3], ...uv[0]] },
            ],
            constraints: [],
        },
    });
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

interface FaceSnap {
    readonly index: number;
    readonly id: string | undefined;
    readonly normal: [number, number, number];
    readonly min: [number, number, number];
    readonly max: [number, number, number];
    readonly area: number;
}

/** Every face of the body with its tracked id, axis-aligned plane and bbox. */
function snapshotFaces(body: ParametricBodyNode): FaceSnap[] {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    return faces.map((face, index) => {
        const n = face.normal(0, 0)[1].normalize()!;
        const box = face.boundingBox();
        return {
            index,
            id: body.faceIdAt(index),
            normal: [round(n.x), round(n.y), round(n.z)],
            min: [round(box.min.x), round(box.min.y), round(box.min.z)],
            max: [round(box.max.x), round(box.max.y), round(box.max.z)],
            area: round(face.area()),
        };
    });
}

/** Face lying on the axis-aligned plane `axis = offset` with outward normal `direction`. */
const atPlane = (s: FaceSnap, axis: 0 | 1 | 2, direction: 1 | -1, offset: number): boolean =>
    s.normal[axis] === direction && s.min[axis] === offset && s.max[axis] === offset;

/** Step 1: 40×40×40 box on the default XY plane. */
function buildBox(doc: TestDocument): { body: ParametricBodyNode; sketch1: SketchNode } {
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
    return { body, sketch1 };
}

/** Step 2: sketch a rect on the x=40 side face and cut it inward (negative = inward). */
function cutGroove(body: ParametricBodyNode, doc: TestDocument, corners: XYZ[], depth: number): void {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const side = faces.find((face) => face.normal(0, 0)[1].x > 1 - 1e-6);
    expect(side).toBeDefined();
    const sketch2 = sketchOnFace(doc, side!, corners);
    doc.modelManager.addNode(sketch2);
    const profiles2 = sketch2.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            sketchId: sketch2.id,
            depth,
            operation: "cut",
            profiles: [captureProfileRef(profiles2[0].shape as unknown as IFace)],
        },
    ]);
}

interface PressPullRecord {
    readonly ref: ProfileRef;
    /** Raw `idsOverlap` hit set the claim rule starts from (before fingerprint narrowing). */
    readonly idOverlapHits: number[];
}

/** Step 3: press-pull one picked face, captured as the command captures it. */
function pressPull(
    body: ParametricBodyNode,
    pick: (s: FaceSnap) => boolean,
    depth: number,
    options?: { unflagged?: boolean },
): PressPullRecord {
    const snaps = snapshotFaces(body);
    const target = snaps.find(pick);
    expect(target).toBeDefined();
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const id = body.faceIdAt(target!.index);
    // The command stamps `splitPiece` when the picked face's id is already shared;
    // `unflagged` simulates a ref stored by a pre-flag document.
    const ref = captureProfileRef(
        faces[target!.index],
        id,
        options?.unflagged === true ? undefined : body.faceIdIsShared(id),
    );
    const idOverlapHits = id === undefined ? [] : body.faceIndexesOfId(id);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e3",
            type: "extrude",
            depth,
            operation: "fuse",
            source: { nodeId: body.id, profiles: [ref] },
        },
    ]);
    return { ref, idOverlapHits };
}

/** The re-anchored press-pull refs — one per face actually swept (see `resolvedProfiles`). */
function e3Profiles(body: ParametricBodyNode): readonly ProfileRef[] | undefined {
    const e3 = body.features.find((f) => f.id === "e3");
    return e3?.type === "extrude" ? e3.source?.profiles : undefined;
}

function featureErrors(body: ParametricBodyNode): (string | undefined)[] {
    return body.featureItems().map((x) => x.error);
}

/** (a) blind pocket: rect y∈[10,30], z∈[15,30] on the x=40 face, cut 15 inward. */
function buildBlindPocket(): ParametricBodyNode {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const { body } = buildBox(doc);
    cutGroove(
        body,
        doc,
        [
            new XYZ({ x: 40, y: 10, z: 15 }),
            new XYZ({ x: 40, y: 30, z: 15 }),
            new XYZ({ x: 40, y: 30, z: 30 }),
            new XYZ({ x: 40, y: 10, z: 30 }),
        ],
        -15,
    );
    return body;
}

/** (b1) open step: rect spans full y∈[0,40], z∈[25,40] on the x=40 face, cut 15 inward. */
function buildOpenStep(): ParametricBodyNode {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const { body } = buildBox(doc);
    cutGroove(
        body,
        doc,
        [
            new XYZ({ x: 40, y: 0, z: 25 }),
            new XYZ({ x: 40, y: 40, z: 25 }),
            new XYZ({ x: 40, y: 40, z: 40 }),
            new XYZ({ x: 40, y: 0, z: 40 }),
        ],
        -15,
    );
    return body;
}

/**
 * (b2) open slot: rect y∈[10,30], z∈[25,40] on the x=40 face, cut THROUGH the box.
 * The overcut (60 > 40) keeps the slot through even when a test shifts the box in x.
 */
function buildThroughSlot(): { body: ParametricBodyNode; sketch1: SketchNode } {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const { body, sketch1 } = buildBox(doc);
    cutGroove(
        body,
        doc,
        [
            new XYZ({ x: 40, y: 10, z: 25 }),
            new XYZ({ x: 40, y: 30, z: 25 }),
            new XYZ({ x: 40, y: 30, z: 40 }),
            new XYZ({ x: 40, y: 10, z: 40 }),
        ],
        -60,
    );
    return { body, sketch1 };
}

describe("(a) blind pocket cut into the side face", () => {
    test("the pocket's five interior faces carry pairwise distinct tracked ids", () => {
        const body = buildBlindPocket();
        expect(featureErrors(body)).toEqual([undefined, undefined]);
        const snaps = snapshotFaces(body);
        const pocket = [
            snaps.find((s) => atPlane(s, 2, -1, 30)), // ceiling
            snaps.find((s) => atPlane(s, 2, 1, 15)), // floor
            snaps.find((s) => atPlane(s, 0, 1, 25)), // back wall
            snaps.find((s) => atPlane(s, 1, 1, 10)), // y=10 wall
            snaps.find((s) => atPlane(s, 1, -1, 30)), // y=30 wall
        ];
        expect(pocket.every((s) => s !== undefined)).toBe(true);
        const ids = pocket.map((s) => s!.id);
        expect(ids.every((id) => typeof id === "string")).toBe(true);
        // No id sharing in the blind pocket: an id-based pick can only claim one face.
        expect(new Set(ids).size).toBe(5);
    });

    test("press-pulling the pocket ceiling sweeps only the ceiling (control)", () => {
        const body = buildBlindPocket();
        const { idOverlapHits } = pressPull(body, (s) => atPlane(s, 2, -1, 30), 5);
        expect(idOverlapHits).toHaveLength(1);
        expect(featureErrors(body)).toEqual([undefined, undefined, undefined]);
        // One face was swept, so the re-anchored ref list stays a single ref.
        expect(e3Profiles(body)).toHaveLength(1);
        const after = snapshotFaces(body);
        // The ceiling moved 30 → 25 (swept 5 into the cavity and joined)...
        expect(after.some((s) => atPlane(s, 2, -1, 25) && s.area === 300)).toBe(true);
        // ...while the floor and both walls keep their planes (only shrunk in z):
        expect(after.some((s) => atPlane(s, 2, 1, 15) && s.area === 300)).toBe(true);
        expect(after.some((s) => atPlane(s, 0, 1, 25) && s.area === 200)).toBe(true);
        expect(after.some((s) => atPlane(s, 1, 1, 10) && s.area === 150)).toBe(true);
        expect(after.some((s) => atPlane(s, 1, -1, 30) && s.area === 150)).toBe(true);
    });
});

describe("(b1) open step spanning the full side width", () => {
    test("the truncated top and the groove floor carry distinct ids; only the top is swept", () => {
        const body = buildOpenStep();
        expect(featureErrors(body)).toEqual([undefined, undefined]);
        const snaps = snapshotFaces(body);
        const top = snaps.find((s) => atPlane(s, 2, 1, 40));
        const floor = snaps.find((s) => atPlane(s, 2, 1, 25));
        expect(top?.area).toBe(1000);
        expect(floor?.area).toBe(600);
        expect(typeof top?.id).toBe("string");
        expect(typeof floor?.id).toBe("string");
        expect(top!.id).not.toBe(floor!.id);

        const { idOverlapHits } = pressPull(body, (s) => atPlane(s, 2, 1, 40), 5);
        expect(idOverlapHits).toHaveLength(1);
        expect(featureErrors(body)).toEqual([undefined, undefined, undefined]);
        expect(e3Profiles(body)).toHaveLength(1);
        const after = snapshotFaces(body);
        expect(after.some((s) => atPlane(s, 2, 1, 45) && s.area === 1000)).toBe(true);
        // The groove floor was not pulled along.
        expect(after.some((s) => atPlane(s, 2, 1, 25) && s.area === 600)).toBe(true);
    });
});

describe("(b2) open slot through the box splitting the top face", () => {
    test("both top pieces carry the SAME tracked id (pieces of a boolean-split face)", () => {
        const { body } = buildThroughSlot();
        expect(featureErrors(body)).toEqual([undefined, undefined]);
        const pieces = snapshotFaces(body).filter((s) => atPlane(s, 2, 1, 40));
        expect(pieces).toHaveLength(2);
        expect(pieces.map((s) => s.area)).toEqual([400, 400]);
        const ySpans = pieces.map((s) => [s.min[1], s.max[1]]).sort((a, b) => a[0] - b[0]);
        expect(ySpans).toEqual([
            [0, 10],
            [30, 40],
        ]);
        expect(typeof pieces[0].id).toBe("string");
        // Pieces of a boolean-split face share one tracked id — correct by design; the
        // press-pull claim rule narrows the pick by fingerprint (the tests below).
        expect(pieces[1].id).toBe(pieces[0].id);
        expect(body.faceIndexesOfId(pieces[0].id!)).toHaveLength(2);
    });

    test("press-pulling ONE top piece sweeps only that piece", () => {
        const { body } = buildThroughSlot();
        const { ref, idOverlapHits } = pressPull(body, (s) => atPlane(s, 2, 1, 40) && s.max[1] === 10, 5);
        // The raw overlap scan finds both pieces; the fingerprint (center y = 5,
        // area 400 — the sibling sits 30mm away) pins the pick to one of them.
        expect(idOverlapHits).toHaveLength(2);
        expect(round(ref.area!)).toBe(400);
        expect(round(ref.center!.y)).toBe(5);
        // The id was already shared by both pieces at pick time: the ref is stamped.
        expect(ref.splitPiece).toBe(true);

        expect(featureErrors(body)).toEqual([undefined, undefined, undefined]);
        const after = snapshotFaces(body);
        // Only the picked piece moved: raised to z = 45...
        const raised = after.filter((s) => atPlane(s, 2, 1, 45));
        expect(raised).toHaveLength(1);
        expect(raised[0].area).toBe(400);
        expect([raised[0].min[1], raised[0].max[1]]).toEqual([0, 10]);
        // ...and the sibling piece is NOT pulled along:
        const sibling = after.filter((s) => atPlane(s, 2, 1, 40));
        expect(sibling).toHaveLength(1);
        expect(sibling[0].area).toBe(400);
        expect([sibling[0].min[1], sibling[0].max[1]]).toEqual([30, 40]);
        // The groove floor was not swept either.
        expect(after.some((s) => atPlane(s, 2, 1, 25) && s.area === 800)).toBe(true);

        // Re-anchoring keeps ONE ref — the id unchanged, the fingerprint of the picked
        // piece, the flag preserved: no self-perpetuating expansion to one ref per
        // piece, and no silent loss of the never-widen contract.
        const profiles = e3Profiles(body);
        expect(profiles).toHaveLength(1);
        expect(profiles![0].id).toBe(ref.id);
        expect(round(profiles![0].center!.y)).toBe(5);
        expect(profiles![0].splitPiece).toBe(true);

        // A subsequent rebuild (re-cut with a deeper overcut — identical result
        // geometry) keeps the sibling unswept and the ref list at one.
        body.setFeaturesEmitShapeChanged(
            body.features.map((f) => (f.id === "e2" ? { ...f, depth: -61 } : f)),
        );
        expect(featureErrors(body)).toEqual([undefined, undefined, undefined]);
        const rebuilt = snapshotFaces(body);
        expect(rebuilt.filter((s) => atPlane(s, 2, 1, 45))).toHaveLength(1);
        const unswept = rebuilt.filter((s) => atPlane(s, 2, 1, 40));
        expect(unswept).toHaveLength(1);
        expect([unswept[0].min[1], unswept[0].max[1]]).toEqual([30, 40]);
        expect(e3Profiles(body)).toHaveLength(1);
        expect(e3Profiles(body)![0].splitPiece).toBe(true);
    });

    test("a stale fingerprint on a flagged ref adopts the clear nearest piece", () => {
        const { body, sketch1 } = buildThroughSlot();
        pressPull(body, (s) => atPlane(s, 2, 1, 40) && s.max[1] === 10, 5);
        expect(snapshotFaces(body).filter((s) => atPlane(s, 2, 1, 45))).toHaveLength(1);

        // Extend the box -10 in x: both top pieces move and grow (center x = 15,
        // area 500), so the stored fingerprint (center (20,5,45), area 400) matches
        // NEITHER piece within tolerance. A flagged ref never widens: the clear
        // nearest piece (the sibling sits 30mm away in y) is adopted instead.
        sketch1.setDataEmitShapeChanged(rect(-10, 0, 40, 40));
        expect(featureErrors(body)).toEqual([undefined, undefined, undefined]);
        const after = snapshotFaces(body);
        const raised = after.filter((s) => atPlane(s, 2, 1, 45));
        expect(raised).toHaveLength(1);
        expect(raised[0].area).toBe(500);
        expect([raised[0].min[1], raised[0].max[1]]).toEqual([0, 10]);
        // The sibling piece is NOT pulled along even with the fingerprint stale.
        const sibling = after.filter((s) => atPlane(s, 2, 1, 40));
        expect(sibling).toHaveLength(1);
        expect(sibling[0].area).toBe(500);
        expect([sibling[0].min[1], sibling[0].max[1]]).toEqual([30, 40]);
        // The re-anchored ref stays single and flagged.
        const profiles = e3Profiles(body);
        expect(profiles).toHaveLength(1);
        expect(profiles![0].splitPiece).toBe(true);
    });

    test("a mirror-symmetric stale fingerprint on a flagged ref fails ambiguous", () => {
        const { body } = buildThroughSlot();
        const snaps = snapshotFaces(body);
        const target = snaps.find((s) => atPlane(s, 2, 1, 40) && s.max[1] === 10);
        expect(target).toBeDefined();
        const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const id = body.faceIdAt(target!.index);
        const picked = captureProfileRef(faces[target!.index], id, body.faceIdIsShared(id));
        expect(picked.splitPiece).toBe(true);

        // A capture-real tie cannot occur (the fingerprint anchors to the picked
        // piece's y-span, so a moved box keeps it nearer its own piece), hence a
        // hand-crafted one: shift the fingerprint +15 in y onto the mirror axis
        // between the pieces (y∈[15,25]) — both score exactly the same.
        const shiftY = (v: XYZLike): XYZLike => ({ x: v.x, y: v.y + 15, z: v.z });
        const crafted: ProfileRef = {
            ...picked,
            center: shiftY(picked.center!),
            edges: picked.edges.map((e) =>
                e.kind === "line" ? { ...e, start: shiftY(e.start), end: shiftY(e.end) } : e,
            ),
        };
        expect(round(crafted.center!.y)).toBe(20);

        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "e3",
                type: "extrude",
                depth: 5,
                operation: "fuse",
                source: { nodeId: body.id, profiles: [crafted] },
            },
        ]);
        // Neither piece is a clear winner: a loud failure, never a silent widen.
        expect(featureErrors(body)).toEqual([undefined, undefined, "Face match is ambiguous after rebuild"]);
        // The failed feature keeps the previous shape: nothing was swept.
        const after = snapshotFaces(body);
        expect(after.filter((s) => atPlane(s, 2, 1, 40))).toHaveLength(2);
        expect(after.some((s) => atPlane(s, 2, 1, 45))).toBe(false);
    });

    test("a legacy ref without the flag keeps the whole-span adoption", () => {
        const { body, sketch1 } = buildThroughSlot();
        const { ref } = pressPull(body, (s) => atPlane(s, 2, 1, 40) && s.max[1] === 10, 5, {
            unflagged: true,
        });
        expect(ref.splitPiece).toBeUndefined();
        expect(snapshotFaces(body).filter((s) => atPlane(s, 2, 1, 45))).toHaveLength(1);

        // Same stale-fingerprint setup as the flagged test, but a ref stored by a
        // pre-flag document has no never-widen contract: zero exact hits keeps the
        // whole-span adoption (the buggy-era behavior, kept for compatibility).
        sketch1.setDataEmitShapeChanged(rect(-10, 0, 40, 40));
        expect(featureErrors(body)).toEqual([undefined, undefined, undefined]);
        const after = snapshotFaces(body);
        const raised = after.filter((s) => atPlane(s, 2, 1, 45));
        expect(raised).toHaveLength(2);
        expect(raised.map((s) => s.area)).toEqual([500, 500]);
        expect(after.some((s) => atPlane(s, 2, 1, 40))).toBe(false);
        // Both pieces were swept and re-anchored — and re-anchoring never stamps the
        // flag on a ref that lacked it.
        const profiles = e3Profiles(body);
        expect(profiles).toHaveLength(2);
        expect(profiles!.every((p) => p.splitPiece === undefined)).toBe(true);
    });
});

describe("press-pull ref serialization", () => {
    test("the splitPiece flag round-trips through the Serializer", () => {
        const { body } = buildThroughSlot();
        pressPull(body, (s) => atPlane(s, 2, 1, 40) && s.max[1] === 10, 5);
        expect(e3Profiles(body)![0].splitPiece).toBe(true);

        const restored = Serializer.deserializeObject(
            body.document,
            Serializer.serializeObject(body),
        ) as ParametricBodyNode;
        const e3 = restored.features.find((f) => f.id === "e3");
        const profiles = e3?.type === "extrude" ? e3.source?.profiles : undefined;
        expect(profiles).toHaveLength(1);
        expect(profiles![0].splitPiece).toBe(true);
    });

    test("refs stored without the flag deserialize unflagged (pre-flag documents)", () => {
        const { body } = buildThroughSlot();
        pressPull(body, (s) => atPlane(s, 2, 1, 40) && s.max[1] === 10, 5, { unflagged: true });

        const serialized = Serializer.serializeObject(body);
        // The field is only ever written when true, keeping the serialized shape of
        // refs stored by pre-flag documents byte-stable.
        expect(JSON.stringify(serialized)).not.toContain("splitPiece");
        const restored = Serializer.deserializeObject(body.document, serialized) as ParametricBodyNode;
        const e3 = restored.features.find((f) => f.id === "e3");
        const profiles = e3?.type === "extrude" ? e3.source?.profiles : undefined;
        expect(profiles).toHaveLength(1);
        expect(profiles![0].splitPiece).toBeUndefined();
    });
});
