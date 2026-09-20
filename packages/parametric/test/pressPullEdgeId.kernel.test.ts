// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Regression suite for the press-pull edge-id gap.
 *
 *   1. rectangle sketch → extrude → 40×40×40 box;
 *   2. rectangle sketch on the x=40 side face, cut THROUGH the box → a slot open at the top,
 *      which splits the box's top face into two pieces sharing one id;
 *   3. press-pull (face-source extrude) one top piece upward;
 *   4. press-pull (face-source extrude) the x=40 side face outward — the pad whose top is the
 *      pressed face's own image;
 *   5. fillet the pad's top edge and the two vertical edges beside it.
 *
 * The reported failure: changing an extrude value afterwards makes the fillet point at OTHER
 * edges. Root cause: `sweepFaceTracked` seeds a prism's edge ids from the sketch-entity
 * attribution (`profileEdgeEntityIds`), which only a sketch profile region ever registers. A
 * press-pull's source is a BODY face, so every seed came back undefined — the pad's bottom
 * edges (identical to the pressed face's own edges, whose ids exist upstream) and the edges
 * the sweep generates from them all ended up with NO id. A fillet on such an edge stores an
 * id-less fingerprint, and after an upstream edit the fingerprint match silently lands on a
 * neighbouring edge.
 *
 * The tests pin, in order:
 * - the pad's own boundary edges carry tracked ids (the ids the fillet needs);
 * - a fillet on them survives an edit of the pad's depth — its rounded surfaces stay on the
 *   pad, instead of silently jumping onto the edges the pad was pulled from.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CurveUtils, type IEdge, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import { captureProfileRef } from "../src/features/profileRef";
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

const round = (x: number) => Math.round(x * 1e6) / 1e6;

function newDoc(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

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

const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const edgesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];

function pressPull(
    body: ParametricBodyNode,
    pick: (face: IFace) => boolean,
    id: string,
    depth: number,
    extra: Record<string, unknown> = {},
): void {
    const faces = facesOf(body);
    const index = faces.findIndex(pick);
    expect(index).toBeGreaterThanOrEqual(0);
    const faceId = body.faceIdAt(index);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id,
            type: "extrude",
            depth,
            operation: "fuse",
            source: {
                nodeId: body.id,
                profiles: [captureProfileRef(faces[index], faceId, body.faceIdIsShared(faceId))],
            },
            ...extra,
        },
    ]);
}

/** The refs the fillet command would store for the edges the predicate picks. */
function filletEdges(body: ParametricBodyNode, pick: (edge: IEdge) => boolean, id: string): void {
    const picked = edgesOf(body)
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => pick(edge));
    expect(picked.length).toBeGreaterThan(0);
    const refs = picked.map(({ edge, index }) => {
        const edgeId = body.edgeIdAt(index);
        return captureEdgeRef(edge, edgeId, body.edgeIdIsShared(edgeId));
    });
    body.setFeaturesEmitShapeChanged([...body.features, { id, type: "fillet", radius: 1, edges: refs }]);
}

/** The refs the fillet feature holds — the anchors the body wrote back. */
function filletRefs(body: ParametricBodyNode, id: string) {
    const feature = body.features.find((x) => x.id === id);
    if (feature?.type !== "fillet") throw new Error(`no fillet ${id}`);
    return feature.edges;
}

/**
 * The distinct planes the fillet's cylindrical surfaces sit on — where the rounded edges are.
 * A fillet on a straight edge puts its cylinder axis `radius` inside that edge, parallel to it,
 * so a fillet on the pad's edges yields axes on one plane and nothing else.
 */
function cylinderPlanes(body: ParametricBodyNode): number[] {
    const axes: number[] = [];
    for (const edge of circularEdges(body)) {
        const basis = edge.curve.basisCurve;
        if (CurveUtils.isCircle(basis)) axes.push(round(basis.center.x));
    }
    return [...new Set(axes)].sort((a, b) => a - b);
}

function circularEdges(body: ParametricBodyNode): IEdge[] {
    return edgesOf(body).filter((edge) => CurveUtils.isCircle(edge.curve.basisCurve));
}

function errors(body: ParametricBodyNode): string {
    return body
        .featureItems()
        .map((x) => `${x.id}=${x.error ?? "ok"}`)
        .join("|");
}

/**
 * The reported scenario up to the fillet: box → through-slot → press-pull one top piece →
 * press-pull the side face the slot was cut from. Returns the body with `e1`..`e4` in place.
 */
function buildPressedPads(padDepth: number): ParametricBodyNode {
    const doc = newDoc();
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

    // The slot: y in [10,30], z in [20,40] on the x=40 face, cut through the box (-60).
    const side = facesOf(body).find((face) => face.normal(0, 0)[1].x > 1 - 1e-6);
    expect(side).toBeDefined();
    const sketch2 = sketchOnFace(doc, side!, [
        new XYZ({ x: 40, y: 10, z: 20 }),
        new XYZ({ x: 40, y: 30, z: 20 }),
        new XYZ({ x: 40, y: 30, z: 40 }),
        new XYZ({ x: 40, y: 10, z: 40 }),
    ]);
    doc.modelManager.addNode(sketch2);
    const profiles2 = sketch2.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            sketchId: sketch2.id,
            depth: -60,
            operation: "cut",
            profiles: [captureProfileRef(profiles2[0].shape as unknown as IFace)],
        },
    ]);
    expect(errors(body)).toBe("e1=ok|e2=ok");

    // Press-pull the top piece at y in [30,40] upward by 5, then the x=40 side face outward.
    pressPull(
        body,
        (face) => {
            const box = face.boundingBox();
            return round(face.normal(0, 0)[1].z) === 1 && round(box.min.z) === 40 && box.min.y >= 30;
        },
        "e3",
        5,
    );
    expect(errors(body)).toBe("e1=ok|e2=ok|e3=ok");
    pressPull(
        body,
        (face) => round(face.normal(0, 0)[1].x) === 1 && round(face.boundingBox().max.x) === 40,
        "e4",
        padDepth,
    );
    expect(errors(body)).toBe("e1=ok|e2=ok|e3=ok|e4=ok");
    return body;
}

/** The pad's corner at the slot: the top edge at z=40 (y 0..10) and the two vertical edges. */
const onPadCorner = (padX: number) => (edge: IEdge) => {
    const s = edge.startPoint();
    const t = edge.endPoint();
    const onPlane = Math.abs(s.x - padX) < 1e-6 && Math.abs(t.x - padX) < 1e-6;
    if (!onPlane) return false;
    const topAtZ40 = Math.abs(s.z - 40) < 1e-6 && Math.abs(t.z - 40) < 1e-6;
    const vertical = Math.abs(s.x - t.x) < 1e-6 && Math.abs(s.y - t.y) < 1e-6;
    return topAtZ40 || (vertical && (Math.abs(s.y - 10) < 1e-6 || Math.abs(s.y - 30) < 1e-6));
};

describe("the edges of a press-pull's pad", () => {
    test("carry tracked ids, so a fillet can anchor on them", () => {
        const body = buildPressedPads(10);
        const picked = edgesOf(body)
            .map((edge, index) => ({ edge, index }))
            .filter(({ edge }) => onPadCorner(50)(edge));
        // The pad's top face outline: two vertical edges plus the top edge at z=40.
        expect(picked).toHaveLength(3);
        const ids = picked.map(({ index }) => body.edgeIdAt(index));
        expect(ids.every((id) => typeof id === "string")).toBe(true);
        // Distinct names — a shared id would be read as one split edge.
        expect(new Set(ids).size).toBe(3);
    });

    test("no name of the pressed body is handed out twice", () => {
        const body = buildPressedPads(10);
        const faceIds = facesOf(body).map((_, index) => body.faceIdAt(index));
        const edgeIds = edgesOf(body).map((_, index) => body.edgeIdAt(index));
        // The invariant that makes the id channel trustworthy: a name belongs to ONE sub-shape.
        // A duplicate reads as pieces of one split sub-shape, so a ref on either would adopt both
        // — the wrong-edge failure this whole suite guards. (Some sub-shapes are deliberately left
        // unnamed instead; `edgesOf(body).filter((_, i) => body.edgeIdAt(i) === undefined)` names
        // the leftovers, and a fillet on one falls back to geometric matching.)
        expect(new Set(edgeIds).size).toBe(edgeIds.length);
        expect(new Set(faceIds).size).toBe(faceIds.length);
        // And most of the pad IS named: before the id gaps were closed, 11 of these 24 edges —
        // including two of the three a fillet anchors on — had no id at all.
        expect(edgeIds.filter((id) => id !== undefined).length).toBeGreaterThanOrEqual(20);
        expect(faceIds.every((id) => id !== undefined)).toBe(true);
    });
});

describe("the corners of a press-pull's pad", () => {
    test("stay named when the pad starts away from the face it was pulled from", () => {
        const doc = newDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 40) });
        doc.modelManager.addNode(sketch);
        const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch.id,
                    depth: 40,
                    profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
                },
            ],
        });
        doc.modelManager.addNode(body);
        // A start offset lifts the pad clear of the box: its corner edges no longer continue the
        // box's own edges, so they cannot borrow an id from them by merging.
        pressPull(
            body,
            (face) => round(face.normal(0, 0)[1].z) === 1 && round(face.boundingBox().max.z) === 40,
            "e2",
            8,
            { startOffset: 5 },
        );
        expect(errors(body)).toBe("e1=ok|e2=ok");

        const verticals = edgesOf(body)
            .map((edge, index) => ({ edge, index }))
            .filter(({ edge }) => {
                const s = edge.startPoint();
                const t = edge.endPoint();
                return Math.abs(s.x - t.x) < 1e-6 && Math.abs(s.y - t.y) < 1e-6 && Math.abs(s.z - t.z) > 1e-6;
            });
        // The pad's four corners: they were unnamed (only geometry left to match on) until the
        // sweep learned to seed a face's corners from the ids of the edges meeting there.
        expect(verticals).toHaveLength(8);
        const padCorners = verticals.filter(({ edge }) => edge.boundingBox().min.z >= 40 - 1e-6);
        expect(padCorners).toHaveLength(4);
        const ids = padCorners.map(({ index }) => body.edgeIdAt(index));
        expect(ids.every((id) => typeof id === "string")).toBe(true);
        expect(new Set(ids).size).toBe(4);
    });
});

describe("a fillet on a press-pulled pad", () => {
    test("keeps its edges when the pad's depth is edited", () => {
        const body = buildPressedPads(10);
        filletEdges(body, onPadCorner(50), "f1");
        expect(errors(body)).toBe("e1=ok|e2=ok|e3=ok|e4=ok|f1=ok");
        // Radius 1 on edges at x=50 → every cylinder axis sits at x=49 (the corner where the
        // rounded edges meet adds one more), and NONE of them sits on the x=40 plane.
        expect(cylinderPlanes(body)).toEqual([49]);
        expect(circularEdges(body).length).toBeGreaterThanOrEqual(3);
        // The fillet's refs are anchored on ids, so a rebuild resolves by identity instead of
        // guessing from geometry.
        const refs = filletRefs(body, "f1");
        expect(refs.every((ref) => typeof ref.edgeId === "string")).toBe(true);

        // Deepen the pad: its edges move 49 → 64, far enough that no fingerprint match finds
        // them (before this, the feature fails with "Edge not found after rebuild" and the body
        // keeps the previous shape — the fillet visibly stays behind). The ids carry it.
        body.setFeaturesEmitShapeChanged(body.features.map((f) => (f.id === "e4" ? { ...f, depth: 25 } : f)));
        expect(errors(body)).toBe("e1=ok|e2=ok|e3=ok|e4=ok|f1=ok");
        expect(cylinderPlanes(body)).toEqual([64]);
    });
});
