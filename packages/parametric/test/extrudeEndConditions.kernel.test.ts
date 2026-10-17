// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, type IVertex, Matrix4, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef, type EdgeRef } from "../src/features/edgeRef";
import type { ExtrudeFeatureData, FeatureData } from "../src/features/feature";
import { captureProfileRef, type ProfileRef } from "../src/features/profileRef";
import { captureVertexRef, type VertexRef } from "../src/features/vertexRef";
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

const circle = (cx: number, cy: number, r: number): SketchData => ({
    entities: [{ id: 1, type: "circle", params: [cx, cy, r] }],
    constraints: [],
});

const round = (x: number) => Math.round(x * 1e6) / 1e6 || 0; // `|| 0` folds -0 into +0
const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const boundsOf = (body: ParametricBodyNode) => body.shape.unchecked()!.boundingBox();

function scene() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

/** One extruded plate body in `doc`: `sketch` on the XY plane extruded `depth` up. */
function plate(
    doc: TestDocument,
    sketch: SketchData,
    depth = 10,
    extra: Partial<ExtrudeFeatureData> = {},
): ParametricBodyNode {
    const sketchNode = new SketchNode({ document: doc, plane: Plane.XY, data: sketch });
    doc.modelManager.addNode(sketchNode);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketchNode.id, depth, ...extra }],
    });
    doc.modelManager.addNode(body);
    return body;
}

/** The body's upward face at height `z`, referenced the way the end-face pick stores it. */
function topFaceRef(body: ParametricBodyNode, z: number): ProfileRef {
    const faces = facesOf(body);
    const index = faces.findIndex((face) => {
        const [point, normal] = face.normal(0, 0);
        return normal.z > 0.9 && Math.abs(point.z - z) < 1e-6;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    const id = body.faceIdAt(index);
    return captureProfileRef(faces[index], id, body.faceIdIsShared(id), true);
}

/** A vertex of the body at height `z`, as the end-vertex pick stores it (world coordinates). */
function vertexRefAt(body: ParametricBodyNode, z: number): VertexRef {
    const vertices = body.shape.unchecked()!.findSubShapes(ShapeTypes.vertex) as IVertex[];
    const vertex = vertices.find((v) => Math.abs(v.point().z - z) < 1e-6);
    expect(vertex).toBeDefined();
    return captureVertexRef(vertex!);
}

describe("extrude end conditions (real kernel)", () => {
    test("throughAll cuts through the whole preceding feature", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 40, 40), 20);
        const hole = new SketchNode({ document: doc, plane: Plane.XY, data: circle(20, 20, 5) });
        doc.modelManager.addNode(hole);
        // The stored blind depth (5) would leave most of the plate standing; throughAll
        // must infer the reach past the plate's far side by itself.
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "e2",
                type: "extrude",
                sketchId: hole.id,
                depth: 5,
                endCondition: "throughAll",
                operation: "cut",
            } as FeatureData,
        ]);

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(40 * 40 * 20 - Math.PI * 25 * 20, 1);
        // 4 walls + top + bottom (both holed) + the cylindrical wall.
        expect(facesOf(body)).toHaveLength(7);
    });

    test("throughAll without a preceding feature fails", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 10, 10), 10, { endCondition: "throughAll" });

        expect(body.shape.isOk).toBe(false);
        expect(errors(body)).toEqual(["Extrude through-all requires a preceding feature"]);
    });

    test("upToFace ends at another body's face and follows its transform", () => {
        const doc = scene();
        const host = plate(doc, rect(0, 0, 40, 40), 20);
        const endFace = { nodeId: host.id, profile: topFaceRef(host, 20) };
        // The stored blind depth (10) would stop halfway; upToFace must reach the face at 20.
        const boss = plate(doc, rect(5, 5, 15, 15), 10, { endCondition: "upToFace", endFace });

        expect(errors(boss)).toEqual([undefined]);
        expect(round(boss.shape.unchecked()!.volume())).toBe(10 * 10 * 20);
        expect(boundsOf(boss).max.z).toBeCloseTo(20, 1);
        // The stored ref re-anchored onto the live face (id-carrying).
        expect((boss.features[0] as ExtrudeFeatureData).endFace?.profile.id).toBeDefined();

        // The target rides its source: lifted +30, the boss reaches the face's new height.
        host.transform = Matrix4.fromTranslation(0, 0, 30);
        expect(errors(boss)).toEqual([undefined]);
        expect(round(boss.shape.unchecked()!.volume())).toBe(10 * 10 * 50);
        expect(boundsOf(boss).max.z).toBeCloseTo(50, 1);
    });

    test("upToFace onto the body's own top face resolves against the chain input", () => {
        const doc = scene();
        const bossSketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(5, 5, 15, 15) });
        doc.modelManager.addNode(bossSketch);
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 40) });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 20 }],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);

        const endFace = { nodeId: body.id, profile: topFaceRef(body, 20) };
        // The boss's footprint is INSIDE the plate's: fused, it adds nothing while it stops
        // at the top face — so a max.z past the plate top would mean the blind depth (30) ran.
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "e2",
                type: "extrude",
                sketchId: bossSketch.id,
                depth: 30,
                endCondition: "upToFace",
                endFace,
                operation: "fuse",
            } as FeatureData,
        ]);
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 20);
        expect(boundsOf(body).max.z).toBeCloseTo(20, 1);

        // Shrink the plate: the boss's end follows the face down (blind 30 would protrude).
        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (f): FeatureData => (f.id === "e1" && f.type === "extrude" ? { ...f, depth: 10 } : f),
            ),
        );
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 10);
        expect(boundsOf(body).max.z).toBeCloseTo(10, 1);
    });

    test.each([
        { endOffset: undefined, expected: 20 },
        { endOffset: 5, expected: 25 },
        { endOffset: -5, expected: 15 },
    ])("upToVertex ends at the vertex plus endOffset (endOffset: $endOffset)", ({ endOffset, expected }) => {
        const doc = scene();
        const host = plate(doc, rect(0, 0, 40, 40), 20);
        const endVertex = { nodeId: host.id, vertex: vertexRefAt(host, 20) };
        const boss = plate(doc, rect(5, 5, 15, 15), 10, {
            endCondition: "upToVertex",
            endVertex,
            ...(endOffset === undefined ? {} : { endOffset }),
        });

        expect(errors(boss)).toEqual([undefined]);
        expect(round(boss.shape.unchecked()!.volume())).toBe(10 * 10 * expected);
        expect(boundsOf(boss).max.z).toBeCloseTo(expected, 1);
    });

    test("an up-to target behind the start plane fails the feature", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 10, 10), 10, {
            endCondition: "upToVertex",
            endVertex: { nodeId: "deleted-node", vertex: { point: { x: 5, y: 5, z: -10 } } },
        });

        expect(body.shape.isOk).toBe(false);
        expect(errors(body)).toEqual([
            "Extrude target lies behind the start plane — flip reverse to reach it",
        ]);
    });

    test("reverse sweeps a blind extrude to the opposite side", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 10, 10), 10, { reverse: true });

        expect(errors(body)).toEqual([undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(1000);
        const bounds = boundsOf(body);
        expect(bounds.min.z).toBeCloseTo(-10, 1);
        expect(bounds.max.z).toBeCloseTo(0, 1);
    });

    test("reverse reaches an up-to target below the start plane", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 10, 10), 10, {
            endCondition: "upToVertex",
            endVertex: { nodeId: "deleted-node", vertex: { point: { x: 5, y: 5, z: -10 } } },
            reverse: true,
        });

        expect(errors(body)).toEqual([undefined]);
        const bounds = boundsOf(body);
        expect(bounds.min.z).toBeCloseTo(-10, 1);
        expect(bounds.max.z).toBeCloseTo(0, 1);
    });

    test("with reverse set, a target on the natural side lies behind", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 10, 10), 10, {
            endCondition: "upToVertex",
            endVertex: { nodeId: "deleted-node", vertex: { point: { x: 5, y: 5, z: 10 } } },
            reverse: true,
        });

        expect(body.shape.isOk).toBe(false);
        expect(errors(body)).toEqual([
            "Extrude target lies behind the start plane — flip reverse to reach it",
        ]);
    });

    test("depth2 sweeps a second depth opposite the sweep direction", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 10, 10), 10, { depth2: 4 });

        expect(errors(body)).toEqual([undefined]);
        // The two halves share the profile-plane cap and fuse into one solid.
        expect(round(body.shape.unchecked()!.volume())).toBe(10 * 10 * 14);
        const bounds = boundsOf(body);
        expect(bounds.min.z).toBeCloseTo(-4, 1);
        expect(bounds.max.z).toBeCloseTo(10, 1);
        const faceIds = facesOf(body).map((_, i) => body.faceIdAt(i));
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
    });

    test("a direction override tilts the prism and follows the source's transform", () => {
        const doc = scene();
        const axle = plate(doc, rect(-1, -1, 1, 1), 50);
        const direction = { nodeId: axle.id, edge: xEdgeRef(axle) };
        // Pitch the source 45° about Y BEFORE the body first reads the edge: the stored
        // local-frame ref re-matches on the axle and the world direction comes out tilted.
        axle.transform = Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, Math.PI / 4);
        const body = plate(doc, rect(0, 0, 10, 10), 10, { direction });

        expect(errors(body)).toEqual([undefined]);
        const before = boundsOf(body);
        expect(before.max.x).toBeCloseTo(10 + 10 / Math.SQRT2, 1);
        expect(before.min.z).toBeCloseTo(-10 / Math.SQRT2, 1);
        // An oblique prism's volume is base area × perpendicular height.
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(10 * 10 * 10 * Math.SQRT1_2, 1);

        // Follow the source to a full right angle: the prism now sweeps straight down.
        axle.transform = Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, Math.PI / 2);
        expect(errors(body)).toEqual([undefined]);
        const after = boundsOf(body);
        expect(after.min.z).toBeCloseTo(-10, 1);
        expect(after.max.x).toBeCloseTo(10, 1);
        expect(round(body.shape.unchecked()!.volume())).toBe(10 * 10 * 10);

        // Rotated back, the direction lies IN the profile plane — a degenerate sweep is an
        // error, not a silent flat prism.
        axle.transform = Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0);
        expect(errors(body)).toEqual(["Extrude direction is parallel to the profile plane"]);
    });
});

/** The axle's bottom edge running along +X (y = −1, z = 0), as the direction pick stores it. */
function xEdgeRef(axle: ParametricBodyNode): EdgeRef {
    const edges = axle.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    // Start/end points, not the bounding box: the box carries the kernel's tolerance padding
    // (~0.025), so a box-edge coordinate never equals the nominal one.
    const index = edges.findIndex((edge) => {
        const start = edge.startPoint();
        const direction = edge.endPoint().sub(start).normalize();
        return (
            direction !== undefined &&
            Math.abs(direction.x) > 1 - 1e-6 &&
            Math.abs(start.y + 1) < 1e-6 &&
            Math.abs(start.z) < 1e-6
        );
    });
    expect(index).toBeGreaterThanOrEqual(0);
    const id = axle.edgeIdAt(index);
    return captureEdgeRef(edges[index], id, axle.edgeIdIsShared(id));
}
