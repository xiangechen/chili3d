// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef, type EdgeRef } from "../src/features/edgeRef";
import type { SweepFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
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

// The path host: a `width`x20 rect extruded by 20. The picked path runs along two
// adjacent top edges: (-10,-10,20) → (width-10,-10,20) → (width-10,10,20).
const pathRect = (width: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [-10, -10, width - 10, -10] },
        { id: 2, type: "line", params: [width - 10, -10, width - 10, 10] },
        { id: 3, type: "line", params: [width - 10, 10, -10, 10] },
        { id: 4, type: "line", params: [-10, 10, -10, -10] },
    ],
    constraints: [],
});

// The swept profile: a 6x6 square at the path start (-10,-10,20), normal along the
// first path segment's tangent (+X). The mirrored variant keeps every entity id on
// the same segment with swapped endpoints, re-enumerating the wire on rebuild.
const profileRect = (mirrored: boolean): SketchData => ({
    entities: mirrored
        ? [
              { id: 1, type: "line", params: [3, -3, -3, -3] },
              { id: 2, type: "line", params: [3, 3, 3, -3] },
              { id: 3, type: "line", params: [-3, 3, 3, 3] },
              { id: 4, type: "line", params: [-3, -3, -3, 3] },
          ]
        : [
              { id: 1, type: "line", params: [-3, -3, 3, -3] },
              { id: 2, type: "line", params: [3, -3, 3, 3] },
              { id: 3, type: "line", params: [3, 3, -3, 3] },
              { id: 4, type: "line", params: [-3, 3, -3, -3] },
          ],
    constraints: [],
});

const PROFILE_PLANE = new Plane({
    origin: new XYZ({ x: -10, y: -10, z: 20 }),
    normal: XYZ.unitX,
    xvec: XYZ.unitY,
});

function facesOf(body: ParametricBodyNode): IFace[] {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
}

function centerOf(face: IFace): XYZ {
    const box = face.boundingBox();
    return new XYZ({
        x: (box.min.x + box.max.x) / 2,
        y: (box.min.y + box.max.y) / 2,
        z: (box.min.z + box.max.z) / 2,
    });
}

const round = (value: number) => {
    const r = Math.round(value * 1e6) / 1e6;
    return r === 0 ? 0 : r;
};

const byCoords = (a: number[], b: number[]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] ?? 0) - (b[3] ?? 0);

/** id → geometry of every face, for a same-geometry comparison across a rebuild. */
function faceSnapshot(body: ParametricBodyNode) {
    const faces: Record<string, number[][]> = {};
    for (const [index, face] of facesOf(body).entries()) {
        const id = body.faceIdAt(index) ?? "?";
        const center = centerOf(face);
        const entry = [round(center.x), round(center.y), round(center.z), round(face.area())];
        if (faces[id] === undefined) faces[id] = [entry];
        else faces[id].push(entry);
    }
    for (const list of Object.values(faces)) list.sort(byCoords);
    return faces;
}

/** Index of the box edge with the given endpoint pair (order-free). */
function edgeIndexAt(body: ParametricBodyNode, a: [number, number, number], b: [number, number, number]) {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const near = (p: XYZ, q: [number, number, number]) =>
        Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]) < 1e-6;
    const index = edges.findIndex((e) => {
        const ends = [e.startPoint(), e.endPoint()];
        return ends.some((p) => near(p, a)) && ends.some((p) => near(p, b));
    });
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

/** The path edge ref, captured exactly as the command does (tracked id channel). */
function pathRef(
    body: ParametricBodyNode,
    a: [number, number, number],
    b: [number, number, number],
): EdgeRef {
    const index = edgeIndexAt(body, a, b);
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const edgeId = body.edgeIdAt(index);
    return captureEdgeRef(edges[index], edgeId, body.edgeIdIsShared(edgeId));
}

function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const pathSketch = new SketchNode({ document: doc, id: "psk", plane: Plane.XY, data: pathRect(20) });
    const profileSketch = new SketchNode({
        document: doc,
        id: "pro",
        plane: PROFILE_PLANE,
        data: profileRect(false),
    });
    doc.modelManager.addNode(pathSketch, profileSketch);
    const pathBody = new ParametricBodyNode({
        document: doc,
        id: "pb1",
        features: [{ id: "e1", type: "extrude", sketchId: pathSketch.id, depth: 20 }],
    });
    doc.modelManager.addNode(pathBody);
    expect(pathBody.shape.isOk).toBe(true);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [sweepFeature(pathBody, profileSketch.id)],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { doc, pathSketch, profileSketch, pathBody, body };
}

function sweepFeature(pathBody: ParametricBodyNode, sketchId: string): SweepFeatureData {
    return {
        id: "f1",
        type: "sweep",
        sketchId,
        path: {
            nodeId: pathBody.id,
            edges: [
                pathRef(pathBody, [-10, -10, 20], [10, -10, 20]),
                pathRef(pathBody, [10, -10, 20], [10, 10, 20]),
            ],
        },
    };
}

describe("sweep ids from the tracked kernel (real kernel)", () => {
    test("side faces take the profile edge seeds, the end cap takes :cap", () => {
        const { body } = setup();

        expect(body.hasTrackedIds("face")).toBe(true);
        const faces = facesOf(body);
        const ids = faces.map((_, index) => body.faceIdAt(index));

        // The four profile edges each sweep at least one side face.
        const sides = ids.filter((id) => id !== undefined && /:ent\d+$/.test(id));
        expect(sides.length).toBeGreaterThanOrEqual(4);
        for (const id of sides) expect(id).toMatch(/^sketch:pro:e[\d.]+:ent\d+$/);

        // Exactly one end cap, at a path end (the wire's intrinsic direction decides which).
        const caps = faces.filter((_, index) => body.faceIdAt(index)?.endsWith(":cap"));
        expect(caps).toHaveLength(1);
        expect(caps[0].area()).toBeCloseTo(36, 3);
        const capCenter = centerOf(caps[0]);
        expect(round(capCenter.z)).toBe(20);
        const atPathEnd = round(capCenter.x) === 10 && round(capCenter.y) === 10;
        const atPathStart = round(capCenter.x) === -10 && round(capCenter.y) === -10;
        expect(atPathEnd || atPathStart).toBe(true);
    });

    test("the ids keep indexing the same geometry across a mirrored rebuild", () => {
        const { profileSketch, body } = setup();
        const before = faceSnapshot(body);

        profileSketch.setDataEmitShapeChanged(profileRect(true));

        expect(body.shape.isOk).toBe(true);
        expect(faceSnapshot(body)).toEqual(before);
    });

    test("the sweep follows a path edit and keeps its id set", () => {
        const { pathSketch, body } = setup();
        const idsBefore = Object.keys(faceSnapshot(body)).sort();
        const xMax = () => round(body.shape.unchecked()!.boundingBox().max.x);
        expect(xMax()).toBe(13);

        // Widen the path body 20 → 30: the picked path edges stretch, the pipe extends
        // along the longer segment (a pure translation would not move a frenet sweep —
        // the profile's offset in the spine's start frame is what matters).
        pathSketch.setDataEmitShapeChanged(pathRect(30));

        expect(body.shape.isOk).toBe(true);
        expect(Object.keys(faceSnapshot(body)).sort()).toEqual(idsBefore);
        expect(xMax()).toBe(23);
    });

    test("a join sweep keeps both operands' ids stable across a rebuild", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const pathSketch = new SketchNode({ document: doc, id: "psk", plane: Plane.XY, data: pathRect(20) });
        const profileSketch = new SketchNode({
            document: doc,
            id: "pro",
            plane: PROFILE_PLANE,
            data: profileRect(false),
        });
        // The base the pipe fuses into: the pipe's first leg (y -13..-7, z 17..23,
        // x -10..10) overlaps this box (x -12..0, y -12..0, z 0..20) in a real volume.
        const baseSketch = new SketchNode({
            document: doc,
            id: "base",
            plane: Plane.XY,
            data: {
                entities: [
                    { id: 1, type: "line", params: [-12, -12, 0, -12] },
                    { id: 2, type: "line", params: [0, -12, 0, 0] },
                    { id: 3, type: "line", params: [0, 0, -12, 0] },
                    { id: 4, type: "line", params: [-12, 0, -12, -12] },
                ],
                constraints: [],
            },
        });
        doc.modelManager.addNode(pathSketch, profileSketch, baseSketch);
        const pathBody = new ParametricBodyNode({
            document: doc,
            id: "pb1",
            features: [{ id: "e1", type: "extrude", sketchId: pathSketch.id, depth: 20 }],
        });
        doc.modelManager.addNode(pathBody);
        expect(pathBody.shape.isOk).toBe(true);
        const body = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [
                { id: "e1", type: "extrude", sketchId: baseSketch.id, depth: 20 },
                { ...sweepFeature(pathBody, profileSketch.id), operation: "fuse" as const },
            ],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);

        // Both operands contribute ids: the base box keeps its sketch-scoped ids, and
        // the swept pipe's faces carry theirs through the boolean.
        const ids = facesOf(body).map((_, index) => body.faceIdAt(index));
        expect(ids.some((id) => id?.startsWith("sketch:base:"))).toBe(true);
        expect(ids.some((id) => id?.startsWith("sketch:pro:"))).toBe(true);

        // A mirrored rebuild (same geometry, re-enumerated wire) keeps every id on the
        // same geometry — the boolean did not disturb the anchoring.
        const before = faceSnapshot(body);
        profileSketch.setDataEmitShapeChanged(profileRect(true));
        expect(body.shape.isOk).toBe(true);
        expect(faceSnapshot(body)).toEqual(before);
    });
});

/**
 * A sweep can take its profile from another body's face instead of a sketch (the `source`
 * contract), and those picks are stored as fingerprints to be re-found on a rebuilt shape.
 * When several stored refs name the SAME face — the pieces a split left behind, meeting the
 * one face they merged back into — the face is swept once and the list heals back to a single
 * ref. That collapse is the point, not a lost pick: the refs described one face all along, so
 * it must not be reported as a missing input (see `pressPullFaceId.kernel.test.ts` for the
 * split-then-re-merge edit that produces it for a press-pull).
 */
describe("a sweep's source picks collapsing onto one face (real kernel)", () => {
    test("a re-merged face heals the list to one ref, with nothing reported missing", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as unknown as typeof doc.visual;
        const sketch = new SketchNode({ document: doc, id: "psk", plane: Plane.XY, data: pathRect(20) });
        doc.modelManager.addNode(sketch);
        // The source is the host itself — the sweep runs on the body whose own top face it
        // presses off, which is the shape a press-pull-onto-yourself takes.
        const host = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 20 }],
        });
        doc.modelManager.addNode(host);
        expect(host.shape.isOk).toBe(true);

        const faces = facesOf(host);
        const top = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
        expect(top).toBeGreaterThanOrEqual(0);
        const topId = host.faceIdAt(top);
        const picked = captureProfileRef(faces[top], topId, host.faceIdIsShared(topId), true);

        host.setFeaturesEmitShapeChanged([
            ...host.features,
            {
                id: "f1",
                type: "sweep",
                path: {
                    nodeId: host.id,
                    edges: [
                        pathRef(host, [-10, -10, 20], [10, -10, 20]),
                        pathRef(host, [10, -10, 20], [10, 10, 20]),
                    ],
                },
                source: { nodeId: host.id, profiles: [{ ...picked }, { ...picked }] },
            } satisfies SweepFeatureData,
        ]);

        const item = host.featureItems()[1];
        expect(item.error).toBeUndefined();
        expect(item.warning).toBeUndefined();
        expect(item.missingInputs).toBeUndefined();
        // Healed: the two refs described one face, so one ref comes back out.
        const stored = host.features[1] as SweepFeatureData;
        expect(stored.source?.profiles).toHaveLength(1);
    });
});
