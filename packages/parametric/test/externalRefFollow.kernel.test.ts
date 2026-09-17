// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Matrix4, Plane, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { ExtrudeFeatureData } from "../src/features/feature";
import { sketchProfiles } from "../src/features/profileBuilder";
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

/** Rectangle 40x20 on the XY plane. */
function rectSketch(): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, 40, 0] },
            { id: 2, type: "line", params: [40, 0, 40, 20] },
            { id: 3, type: "line", params: [40, 20, 0, 20] },
            { id: 4, type: "line", params: [0, 20, 0, 0] },
        ],
        constraints: [],
    };
}

test("external refs on a side face follow an extrude length edit, carrying constrained entities", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    // sketch1 → extruded body (the solid sketch2 references)
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rectSketch() });
    doc.modelManager.addNode(sketch1);
    const faceRanges = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(1);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch1.id,
                depth: 10,
                profiles: [captureProfileRef(faceRanges[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // sketch2 on the front face (y=0), captured exactly like the face-sketch command
    // does it: boundary edges become reference-role external refs with tracked edge
    // ids. The front-face plane is invariant under a length edit, so only the edges
    // move — the top edge from z=10 to z=30.
    const bodyEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const bodyFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const front = bodyFaces.find((face) => face.normal(0, 0)[1].y < -1 + 1e-6);
    expect(front).toBeDefined();
    const plane = sketchPlaneOfFace(front!);
    const refs: ExternalRefData[] = [];
    let nextId = FIRST_EXTERNAL_ENTITY_ID;
    for (const localEdge of front!.findSubShapes(ShapeTypes.edge) as IEdge[]) {
        const index = bodyEdges.findIndex((edge) => edge.isEqual(localEdge));
        const edgeId = index < 0 ? undefined : body.edgeIdAt(index);
        const ref = captureExternalRef(nextId, body.id, plane, localEdge, edgeId, "reference");
        if (ref !== undefined) refs.push(ref);
        nextId--;
    }
    expect(refs.length).toBe(4);

    // The front-face frame has u = x, v = z: the top edge ref sits at v=10.
    const topRef = refs.find(
        (ref) => Math.abs(ref.snapshot[1] - 10) < 1e-9 && Math.abs(ref.snapshot[3] - 10) < 1e-9,
    );
    const bottomRef = refs.find(
        (ref) => Math.abs(ref.snapshot[1]) < 1e-9 && Math.abs(ref.snapshot[3]) < 1e-9,
    );
    expect(topRef?.edge.edgeId).toBeDefined();
    expect(bottomRef?.edge.edgeId).toBeDefined();

    // A sketch2 line with its start point coincident to the top edge's start corner.
    const data: SketchData = {
        entities: [{ id: 1, type: "line", params: [topRef!.snapshot[0], 10, 15, 5] }],
        constraints: [
            {
                id: 1,
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: topRef!.entityId, pointIndex: 0 },
                ],
            },
        ],
        externalRefs: refs,
    };
    const sketch2 = new SketchNode({ document: doc, plane, data });
    doc.modelManager.addNode(sketch2);
    // lazy first generation installs the source-node watch
    expect(sketch2.shape.isOk).toBe(true);

    // The user edit: extrude length 10 → 30.
    const feature = body.features[0] as ExtrudeFeatureData;
    body.setFeaturesEmitShapeChanged([{ ...feature, depth: 30 }]);
    expect(body.shape.isOk).toBe(true);

    // The top ref still identifies the top edge — not dangling, and not stolen by
    // the bottom edge (the stale fingerprint was closer to z=0 after the edit).
    const after = sketch2.data.externalRefs!;
    const top = after.find((ref) => ref.entityId === topRef!.entityId)!;
    const bottom = after.find((ref) => ref.entityId === bottomRef!.entityId)!;
    expect(top.dangling).toBeUndefined();
    expect(top.edge.edgeId).toBe(topRef!.edge.edgeId);
    expect(top.snapshot[1]).toBeCloseTo(30, 6);
    expect(top.snapshot[3]).toBeCloseTo(30, 6);
    expect(bottom.dangling).toBeUndefined();
    expect(bottom.snapshot[1]).toBeCloseTo(0, 6);

    // The coincident line start rode the corner up — the off-session re-solve ran.
    const params = sketch2.data.entities[0].params;
    expect(params[0]).toBeCloseTo(top.snapshot[0], 6);
    expect(params[1]).toBeCloseTo(30, 6);
});

test("a ref added after the first evaluation watches its source immediately", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rectSketch() });
    doc.modelManager.addNode(sketch1);
    const faceRanges = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(1);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch1.id,
                depth: 10,
                profiles: [captureProfileRef(faceRanges[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // sketch2 starts with NO refs — the first evaluation runs the resolution with
    // an empty ref set, which is exactly what used to leave the freshness flag set…
    const bodyEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const bodyFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const front = bodyFaces.find((face) => face.normal(0, 0)[1].y < -1 + 1e-6);
    expect(front).toBeDefined();
    const plane = sketchPlaneOfFace(front!);
    const sketch2 = new SketchNode({ document: doc, plane, data: { entities: [], constraints: [] } });
    doc.modelManager.addNode(sketch2);
    expect(sketch2.shape.isOk).toBe(true);

    // …so the evaluation triggered by adding the ref landed on the skip branch and
    // never registered the source watch. The watch is unconditional now.
    const topLocal = (front!.findSubShapes(ShapeTypes.edge) as IEdge[]).find(
        (edge) => Math.abs(edge.startPoint().z - 10) < 1e-6 && Math.abs(edge.endPoint().z - 10) < 1e-6,
    );
    expect(topLocal).toBeDefined();
    const edgeIndex = bodyEdges.findIndex((edge) => edge.isEqual(topLocal!));
    expect(edgeIndex).toBeGreaterThanOrEqual(0);
    const ref = captureExternalRef(
        FIRST_EXTERNAL_ENTITY_ID,
        body.id,
        plane,
        topLocal!,
        body.edgeIdAt(edgeIndex),
        "reference",
    );
    expect(ref).toBeDefined();
    sketch2.setDataEmitShapeChanged({ entities: [], constraints: [], externalRefs: [ref!] });

    // moving the source must resolve the ref right away, not one evaluation later
    const feature = body.features[0] as ExtrudeFeatureData;
    body.setFeaturesEmitShapeChanged([{ ...feature, depth: 30 }]);

    const after = sketch2.data.externalRefs!;
    expect(after.length).toBe(1);
    expect(after[0].dangling).toBeUndefined();
    expect(after[0].snapshot[1]).toBeCloseTo(30, 6);
    expect(after[0].snapshot[3]).toBeCloseTo(30, 6);
});

test("a dangling profile-role external ref surfaces as a warning on the consuming feature", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    const danglingRef = (entityId: number, role: "reference" | "profile"): ExternalRefData => ({
        entityId,
        nodeId: "missing-source",
        edge: { kind: "line", start: { x: 50, y: 50, z: 0 }, end: { x: 60, y: 50, z: 0 } },
        role,
        snapshot: [50, 50, 60, 50],
        type: "line",
    });
    const withRefs = (refs: ExternalRefData[]): SketchData => ({ ...rectSketch(), externalRefs: refs });

    // the open dangling segment is disjoint from the rect: it builds no profile,
    // so the sketch and the extrude both succeed on the degraded geometry
    const profileSketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        data: withRefs([danglingRef(FIRST_EXTERNAL_ENTITY_ID, "profile")]),
    });
    const referenceSketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        data: withRefs([danglingRef(FIRST_EXTERNAL_ENTITY_ID, "reference")]),
    });
    doc.modelManager.addNode(profileSketch);
    doc.modelManager.addNode(referenceSketch);
    expect(profileSketch.shape.isOk).toBe(true);
    expect(referenceSketch.shape.isOk).toBe(true);

    const body = (id: string, sketch: SketchNode) => {
        const node = new ParametricBodyNode({
            document: doc,
            features: [{ id, type: "extrude", sketchId: sketch.id, depth: 10 }],
        });
        doc.modelManager.addNode(node);
        expect(node.shape.isOk).toBe(true);
        return node;
    };
    const profileBody = body("e-profile", profileSketch);
    const referenceBody = body("e-reference", referenceSketch);

    // the profile-role ref feeds profiles from a frozen snapshot → warning on the
    // feature (a foreign source can never be explained by this body's own timeline);
    // the reference-role one builds nothing and stays silent
    const profileItem = profileBody.featureItems().find((x) => x.id === "e-profile");
    expect(profileItem?.warning).toBe("Sketch has unresolved external references");
    expect(profileItem?.error).toBeUndefined();
    const referenceItem = referenceBody.featureItems().find((x) => x.id === "e-reference");
    expect(referenceItem?.warning).toBeUndefined();
    expect(referenceItem?.error).toBeUndefined();
});

test("a cut that consumes the referenced edge stays silent; an upstream loss still warns", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    // sketch1 → 40x20x10 box (the solid sketch2 is created on)
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rectSketch() });
    doc.modelManager.addNode(sketch1);
    const faceRanges = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(1);
    const e1: ExtrudeFeatureData = {
        id: "e1",
        type: "extrude",
        sketchId: sketch1.id,
        depth: 10,
        profiles: [captureProfileRef(faceRanges[0].shape as unknown as IFace)],
    };
    const body = new ParametricBodyNode({ document: doc, features: [e1] });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // sketch2 on the front face (y=0; frame u=x, v=z): three drawn lines plus the
    // face's top edge as a profile-role ref close a rectangle — the "draw lines
    // against the solid's edge, then cut" scenario — anchored at the current feature
    // count exactly like the face-sketch command records it.
    const bodyEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const bodyFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const front = bodyFaces.find((face) => face.normal(0, 0)[1].y < -1 + 1e-6);
    expect(front).toBeDefined();
    const plane = sketchPlaneOfFace(front!);
    const topLocal = (front!.findSubShapes(ShapeTypes.edge) as IEdge[]).find(
        (edge) => Math.abs(edge.startPoint().z - 10) < 1e-6 && Math.abs(edge.endPoint().z - 10) < 1e-6,
    );
    expect(topLocal).toBeDefined();
    const edgeIndex = bodyEdges.findIndex((edge) => edge.isEqual(topLocal!));
    expect(edgeIndex).toBeGreaterThanOrEqual(0);
    const ref = captureExternalRef(
        FIRST_EXTERNAL_ENTITY_ID,
        body.id,
        plane,
        topLocal!,
        body.edgeIdAt(edgeIndex),
        "profile",
    );
    expect(ref).toBeDefined();
    const data: SketchData = {
        entities: [
            { id: 1, type: "line", params: [5, 10, 5, 4] },
            { id: 2, type: "line", params: [5, 4, 15, 4] },
            { id: 3, type: "line", params: [15, 4, 15, 10] },
        ],
        constraints: [],
        externalRefs: [ref!],
        refPositions: { [body.id]: 1 },
    };
    const sketch2 = new SketchNode({ document: doc, plane, data });
    doc.modelManager.addNode(sketch2);
    expect(sketch2.shape.isOk).toBe(true);

    // the cut: sweep the rectangle into the box (the front normal is -Y → depth < 0)
    const cut: ExtrudeFeatureData = {
        id: "cut",
        type: "extrude",
        sketchId: sketch2.id,
        depth: -4,
        operation: "cut",
    };
    body.setFeaturesEmitShapeChanged([e1, cut]);
    expect(body.shape.isOk).toBe(true);

    // The cut consumed the ref edge's middle span, but at the sketch's timeline
    // anchor (the pre-cut box) the edge still exists in full: the ref resolves
    // there — not dangling, snapshot untouched — and nothing is reported.
    expect(sketch2.data.externalRefs![0].dangling).toBeUndefined();
    expect(sketch2.data.externalRefs![0].snapshot).toEqual(ref!.snapshot);
    const cutItem = body.featureItems().find((x) => x.id === "cut");
    expect(cutItem?.warning).toBeUndefined();
    expect(cutItem?.error).toBeUndefined();

    // Upstream loss: the box narrows to x ∈ [0,10], so the stored 40-wide edge no
    // longer matches even at the anchor → the warning comes back.
    sketch1.setDataEmitShapeChanged({
        entities: [
            { id: 1, type: "line", params: [0, 0, 10, 0] },
            { id: 2, type: "line", params: [10, 0, 10, 20] },
            { id: 3, type: "line", params: [10, 20, 0, 20] },
            { id: 4, type: "line", params: [0, 20, 0, 0] },
        ],
        constraints: [],
    });
    expect(body.shape.isOk).toBe(true);
    const after = body.featureItems().find((x) => x.id === "cut");
    expect(after?.warning).toBe("Sketch has unresolved external references");
});

test("one line plus two referenced edges closing a triangle survives the cut", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    // sketch1 → 40x20x10 box (the solid sketch2 is created on)
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rectSketch() });
    doc.modelManager.addNode(sketch1);
    const faceRanges = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(1);
    const e1: ExtrudeFeatureData = {
        id: "e1",
        type: "extrude",
        sketchId: sketch1.id,
        depth: 10,
        profiles: [captureProfileRef(faceRanges[0].shape as unknown as IFace)],
    };
    const body = new ParametricBodyNode({ document: doc, features: [e1] });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // sketch2 on the front face (y=0; frame u=x, v=z): the top edge (v=10) and the
    // right edge (u=40) become profile-role refs; one drawn line from (10,10) on the
    // top edge to (40,4) on the right edge closes a triangle with them. The
    // PointOnLine constraints are what the editor's auto-constraints add — and what
    // pulls the off-session re-solve into the post-cut cascade.
    const bodyEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const bodyFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const front = bodyFaces.find((face) => face.normal(0, 0)[1].y < -1 + 1e-6);
    expect(front).toBeDefined();
    const plane = sketchPlaneOfFace(front!);
    const frontEdges = front!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const topLocal = frontEdges.find(
        (edge) => Math.abs(edge.startPoint().z - 10) < 1e-6 && Math.abs(edge.endPoint().z - 10) < 1e-6,
    );
    const rightLocal = frontEdges.find(
        (edge) => Math.abs(edge.startPoint().x - 40) < 1e-6 && Math.abs(edge.endPoint().x - 40) < 1e-6,
    );
    expect(topLocal).toBeDefined();
    expect(rightLocal).toBeDefined();
    const capture = (entityId: number, local: IEdge) => {
        const index = bodyEdges.findIndex((edge) => edge.isEqual(local));
        expect(index).toBeGreaterThanOrEqual(0);
        const ref = captureExternalRef(entityId, body.id, plane, local, body.edgeIdAt(index), "profile");
        expect(ref).toBeDefined();
        return ref!;
    };
    const topRef = capture(FIRST_EXTERNAL_ENTITY_ID, topLocal!);
    const rightRef = capture(FIRST_EXTERNAL_ENTITY_ID - 1, rightLocal!);
    // Anchor the drawn line to the refs' own snapshots instead of assuming the
    // sketch frame's orientation (sketchPlaneOfFace chooses it): the line runs from
    // mid-top-edge to mid-right-edge, T-touching both — one click onto each edge.
    const [tu1, tv1, tu2] = topRef.snapshot;
    const [ru1, rv1, , rv2] = rightRef.snapshot;
    const data: SketchData = {
        entities: [{ id: 1, type: "line", params: [(tu1 + tu2) / 2, tv1, ru1, (rv1 + rv2) / 2] }],
        constraints: [
            {
                id: 1,
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: topRef.entityId, pointIndex: 0 },
                    { entityId: topRef.entityId, pointIndex: 1 },
                ],
            },
            {
                id: 2,
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: 1, pointIndex: 1 },
                    { entityId: rightRef.entityId, pointIndex: 0 },
                    { entityId: rightRef.entityId, pointIndex: 1 },
                ],
            },
        ],
        externalRefs: [topRef, rightRef],
        refPositions: { [body.id]: 1 },
    };
    const sketch2 = new SketchNode({ document: doc, plane, data });
    doc.modelManager.addNode(sketch2);
    expect(sketch2.shape.isOk).toBe(true);
    const preCutProfiles = sketchProfiles(sketch2);
    expect(preCutProfiles.isOk).toBe(true);

    // the cut: sweep the triangle into the box (the front normal is -Y → depth < 0)
    const cut: ExtrudeFeatureData = {
        id: "cut",
        type: "extrude",
        sketchId: sketch2.id,
        depth: -4,
        operation: "cut",
    };
    body.setFeaturesEmitShapeChanged([e1, cut]);
    expect(body.shape.isOk).toBe(true);
    expect(sketch2.shape.isOk).toBe(true);

    // The cut consumed pieces of both referenced edges, but at the sketch's timeline
    // anchor (the pre-cut box) both still exist in full: the refs resolve there —
    // no dangling, no re-anchor to a surviving piece, the triangle profile keeps
    // building, and the feature reports neither error nor warning.
    const refsAfter = sketch2.data.externalRefs!;
    expect(refsAfter[0].dangling).toBeUndefined();
    expect(refsAfter[1].dangling).toBeUndefined();
    expect(refsAfter[0].snapshot).toEqual(topRef.snapshot);
    expect(refsAfter[1].snapshot).toEqual(rightRef.snapshot);
    const postCutProfiles = sketchProfiles(sketch2);
    expect(postCutProfiles.isOk).toBe(true);
    const cutItem = body.featureItems().find((x) => x.id === "cut");
    expect(cutItem?.error).toBeUndefined();
    expect(cutItem?.warning).toBeUndefined();
});

test("a depth shrink past the cut triangle blames the cut, and the chain recovers", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    // sketch1 → 40x20x10 box
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rectSketch() });
    doc.modelManager.addNode(sketch1);
    const faceRanges = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const e1: ExtrudeFeatureData = {
        id: "e1",
        type: "extrude",
        sketchId: sketch1.id,
        depth: 10,
        profiles: [captureProfileRef(faceRanges[0].shape as unknown as IFace)],
    };
    const body = new ParametricBodyNode({ document: doc, features: [e1] });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // sketch2 triangle on the front face (frame u=x, v=z): the top edge and the
    // right edge as profile-role refs, one drawn line from mid-top to 60% up the
    // right edge — the triangle spans v=6..10.
    const bodyEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const bodyFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const front = bodyFaces.find((face) => face.normal(0, 0)[1].y < -1 + 1e-6);
    expect(front).toBeDefined();
    const plane = sketchPlaneOfFace(front!);
    const frontEdges = front!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const topLocal = frontEdges.find(
        (edge) => Math.abs(edge.startPoint().z - 10) < 1e-6 && Math.abs(edge.endPoint().z - 10) < 1e-6,
    );
    const rightLocal = frontEdges.find(
        (edge) => Math.abs(edge.startPoint().x - 40) < 1e-6 && Math.abs(edge.endPoint().x - 40) < 1e-6,
    );
    expect(topLocal).toBeDefined();
    expect(rightLocal).toBeDefined();
    const capture = (entityId: number, local: IEdge) => {
        const index = bodyEdges.findIndex((edge) => edge.isEqual(local));
        expect(index).toBeGreaterThanOrEqual(0);
        const ref = captureExternalRef(entityId, body.id, plane, local, body.edgeIdAt(index), "profile");
        expect(ref).toBeDefined();
        return ref!;
    };
    const topRef = capture(FIRST_EXTERNAL_ENTITY_ID, topLocal!);
    const rightRef = capture(FIRST_EXTERNAL_ENTITY_ID - 1, rightLocal!);
    const [tu1, tv1, tu2] = topRef.snapshot;
    const [ru1, rv1, , rv2] = rightRef.snapshot;
    const data: SketchData = {
        entities: [{ id: 1, type: "line", params: [(tu1 + tu2) / 2, tv1, ru1, rv1 + (rv2 - rv1) * 0.6] }],
        constraints: [
            {
                id: 1,
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: topRef.entityId, pointIndex: 0 },
                    { entityId: topRef.entityId, pointIndex: 1 },
                ],
            },
            {
                id: 2,
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: 1, pointIndex: 1 },
                    { entityId: rightRef.entityId, pointIndex: 0 },
                    { entityId: rightRef.entityId, pointIndex: 1 },
                ],
            },
        ],
        externalRefs: [topRef, rightRef],
        refPositions: { [body.id]: 1 },
    };
    const sketch2 = new SketchNode({ document: doc, plane, data });
    doc.modelManager.addNode(sketch2);

    const cut: ExtrudeFeatureData = {
        id: "cut",
        type: "extrude",
        sketchId: sketch2.id,
        depth: -4,
        operation: "cut",
    };
    body.setFeaturesEmitShapeChanged([e1, cut]);
    expect(body.shape.isOk).toBe(true);

    // Fillet the pocket edge parallel to the extrusion direction (the cut's back
    // wall at x=40) — the pick captures the tracked id like the command does.
    const picked = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
        .map((edge, index) => ({ edge, index }))
        .find(({ edge }) => {
            const s = edge.startPoint();
            const e = edge.endPoint();
            return (
                Math.abs(s.x - 40) < 1e-6 &&
                Math.abs(s.y - 4) < 1e-6 &&
                Math.abs(e.x - s.x) < 1e-9 &&
                Math.abs(e.y - s.y) < 1e-9 &&
                Math.abs(e.z - s.z) > 1e-6
            );
        });
    expect(picked).toBeDefined();
    const fillet = {
        id: "f1",
        type: "fillet" as const,
        radius: 1,
        edges: [captureEdgeRef(picked!.edge, body.edgeIdAt(picked!.index))],
    };
    body.setFeaturesEmitShapeChanged([e1, cut, fillet]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);

    // The user edit: shrink the extrude below the triangle's span (v=6..10 vs the
    // new 4-tall box). The chain's first pass re-resolves the sketch's external
    // refs against the in-flight timeline, so the line rides the shrunken top edge
    // and the cut fails as the sketch-level problem it is — instead of the stale
    // no-op cut letting the fillet report "Edge not found after rebuild", which
    // used to wedge the chain (the failed pass kept the old shape, so the sketch's
    // source watch never fired and the stale geometry never caught up).
    body.setFeaturesEmitShapeChanged([{ ...e1, depth: 4 }, cut, fillet]);
    // the off-session re-solve ran before the cut evaluated: the line start rode down
    expect(sketch2.data.entities[0].params[1]).toBeCloseTo(4, 6);
    const items = body.featureItems();
    expect(items.find((x) => x.id === "cut")?.error).toBe("No bounded regions found");
    expect(items.find((x) => x.id === "f1")?.error).toBeUndefined();
    // a failed chain keeps the last good shape
    expect(body.shape.isOk).toBe(true);

    // Restoring the depth rebuilds the triangle — the chain recovers, fillet included.
    body.setFeaturesEmitShapeChanged([e1, cut, fillet]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
});

test("a mid-chain read with an uninitialized shape resolves refs at the timeline anchor", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    // sketch1 → 40x20x10 box (the solid sketch2 is created on)
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rectSketch() });
    doc.modelManager.addNode(sketch1);
    const faceRanges = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(1);
    const e1: ExtrudeFeatureData = {
        id: "e1",
        type: "extrude",
        sketchId: sketch1.id,
        depth: 10,
        profiles: [captureProfileRef(faceRanges[0].shape as unknown as IFace)],
    };
    const body = new ParametricBodyNode({ document: doc, features: [e1] });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // sketch2 on the front face (y=0; frame u=x, v=z): three drawn lines plus the
    // face's top edge as a profile-role ref close a rectangle — anchored at the
    // current feature count exactly like the face-sketch command records it.
    const bodyEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const bodyFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const front = bodyFaces.find((face) => face.normal(0, 0)[1].y < -1 + 1e-6);
    expect(front).toBeDefined();
    const plane = sketchPlaneOfFace(front!);
    const topLocal = (front!.findSubShapes(ShapeTypes.edge) as IEdge[]).find(
        (edge) => Math.abs(edge.startPoint().z - 10) < 1e-6 && Math.abs(edge.endPoint().z - 10) < 1e-6,
    );
    expect(topLocal).toBeDefined();
    const edgeIndex = bodyEdges.findIndex((edge) => edge.isEqual(topLocal!));
    expect(edgeIndex).toBeGreaterThanOrEqual(0);
    const ref = captureExternalRef(
        FIRST_EXTERNAL_ENTITY_ID,
        body.id,
        plane,
        topLocal!,
        body.edgeIdAt(edgeIndex),
        "profile",
    );
    expect(ref).toBeDefined();
    const data: SketchData = {
        entities: [
            { id: 1, type: "line", params: [5, 10, 5, 4] },
            { id: 2, type: "line", params: [5, 4, 15, 4] },
            { id: 3, type: "line", params: [15, 4, 15, 10] },
        ],
        constraints: [],
        externalRefs: [ref!],
        refPositions: { [body.id]: 1 },
    };
    const sketch2 = new SketchNode({ document: doc, plane, data });
    doc.modelManager.addNode(sketch2);
    expect(sketch2.shape.isOk).toBe(true);

    // the cut consuming sketch2 — body B = [extrude(sketch1), cut(sketch2)]
    const cut: ExtrudeFeatureData = {
        id: "cut",
        type: "extrude",
        sketchId: sketch2.id,
        depth: -4,
        operation: "cut",
    };
    body.setFeaturesEmitShapeChanged([e1, cut]);
    expect(body.shape.isOk).toBe(true);
    expect(sketch2.data.externalRefs![0].dangling).toBeUndefined();

    // Simulate the document reopening: the deserialized body has never evaluated,
    // so a mid-chain reader gets the pre-run "Shape not initialized" error and the
    // cache and timeline are empty — the repro that used to mark every ref of
    // sketch2 dangling on the first read and persist it without self-healing.
    (body as any)._shape = Result.err("Shape not initialized");
    (body as any)._evaluated = false;
    (body as any)._timeline.dispose();

    // The first read re-runs the chain; at the cut feature the chain re-resolves
    // sketch2's refs — mid-chain. The anchor path serves them from the in-flight
    // timeline (the state entering the cut feature), not from the error shape.
    expect(body.shape.isOk).toBe(true);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
    const after = sketch2.data.externalRefs![0];
    expect(after.dangling).toBeUndefined();
    expect(after.snapshot).toEqual(ref!.snapshot);
    expect(body.featureItems().map((x) => x.warning)).toEqual([undefined, undefined]);
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

test("boundary refs of a boolean-born face carry tracked ids through a groove edit", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    // Box 40x40x20 (sketch1 → e1); notch cut from the front face (sketch2 → e2, cut):
    // x ∈ [-10,10], z ∈ [12,20], 10 deep — the groove opens at front and top, floor
    // at z = 12. The sketch2 plane's UV is literally (x, z).
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

    // The groove floor is boolean-born: wire exploration decorates its edges with a
    // reversed orientation, so an IsEqual lookup misses every one of them on the
    // body's edge list — the capture must match by IsSame instead.
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const floor = faces.find((face) => {
        const [point, normal] = face.normal(0, 0);
        return normal.z > 0.9 && Math.abs(point.z - 12) < 1e-6;
    });
    expect(floor).toBeDefined();
    const floorEdges = floor!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const bodyEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const equalHits = floorEdges.filter((local) => bodyEdges.some((edge) => edge.isEqual(local)));
    expect(equalHits).toHaveLength(0);

    const plane = sketchPlaneOfFace(floor!);
    const refs = captureBoundaryExternalRefs(
        body,
        { kind: "face", data: { shape: floor!, transform: Matrix4.identity() } as any },
        plane,
    );
    expect(refs).toHaveLength(4);
    // Every ref carries its tracked edge id — before the fix they were all undefined.
    expect(refs!.every((ref) => ref.edge.edgeId !== undefined)).toBe(true);
    const leftRef = refs!.find(
        (ref) => Math.abs(ref.snapshot[0] + 10) < 1e-9 && Math.abs(ref.snapshot[2] + 10) < 1e-9,
    );
    expect(leftRef?.edge.edgeId).toBeDefined();

    const sketch3 = new SketchNode({
        document: doc,
        plane,
        data: { entities: [], constraints: [], externalRefs: refs, refPositions: { [body.id]: 2 } },
    });
    doc.modelManager.addNode(sketch3);
    expect(sketch3.shape.isOk).toBe(true);

    // Widen the groove: x ∈ [-10,10] → [-15,15]. The floor's edges move rigidly and
    // the tracked ids carry the refs across — a fingerprint-only ref rides the score
    // race instead (the wrong winner or a bogus dangling flag past the clear-winner
    // gate).
    sketch2.setDataEmitShapeChanged(rectUV(-15, 12, 15, 20));
    expect(body.shape.isOk).toBe(true);

    const after = sketch3.data.externalRefs!;
    expect(after.every((ref) => ref.dangling !== true)).toBe(true);
    const left = after.find((ref) => ref.entityId === leftRef!.entityId)!;
    expect(left.edge.edgeId).toBe(leftRef!.edge.edgeId);
    expect(left.snapshot[0]).toBeCloseTo(-15, 6);
    expect(left.snapshot[2]).toBeCloseTo(-15, 6);
});
