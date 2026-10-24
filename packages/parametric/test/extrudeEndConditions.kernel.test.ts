// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, type IVertex, Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
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

    /**
     * A curved target has no plane to land on: the conforming build (`extrudeToFace.ts`,
     * kernel `prismToFaceTracked`) caps the prism with a patch of the surface itself,
     * stopping at its NEAR side along the sweep — and which side is near follows the
     * sweep, so the same face reached downward caps onto its top half.
     */
    test("upToFace onto a cylindrical face caps with the surface, in whichever direction", () => {
        const doc = scene();
        // A cylinder along X: the sketch plane's local Y is world Z (normal X, xvec Y), so
        // the circle at local (0, 30) centres the axis at (y=0, z=30); radius 10, extruded
        // 30 along +X — its side face runs z∈[20,40].
        const cylinderSketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY }),
            data: circle(0, 30, 10),
        });
        doc.modelManager.addNode(cylinderSketch);
        const cylinder = new ParametricBodyNode({
            document: doc,
            features: [{ id: "e1", type: "extrude", sketchId: cylinderSketch.id, depth: 30 }],
        });
        doc.modelManager.addNode(cylinder);
        expect(cylinder.shape.isOk).toBe(true);

        // The cylindrical SIDE face: the one non-planar face.
        const cylinderFaces = facesOf(cylinder);
        const sideIndex = cylinderFaces.findIndex((face) => !face.surface().isPlanar());
        expect(sideIndex).toBeGreaterThanOrEqual(0);
        const sideId = cylinder.faceIdAt(sideIndex);
        const endFace = {
            nodeId: cylinder.id,
            profile: captureProfileRef(
                cylinderFaces[sideIndex],
                sideId,
                cylinder.faceIdIsShared(sideId),
                true,
            ),
        };

        // Sweeping UP from z=0, the cap lies ON the surface: over the profile (x∈[5,15]
        // along the axis, y∈[-5,5]) it reaches z = 30 - sqrt(100 - 25) ≈ 21.34 at the y=±5
        // rims. The tangent plane (z=20) would be the sampled fallback; the far side (z=40)
        // would mean the prism passed through the cylinder.
        const fromBelow = plate(doc, rect(5, -5, 15, 5), 10, { endCondition: "upToFace", endFace });
        expect(errors(fromBelow)).toEqual([undefined]);
        expect(boundsOf(fromBelow).max.z).toBeCloseTo(30 - Math.sqrt(75), 1);
        const belowCaps = (fromBelow.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).filter(
            (face) => !face.surface().isPlanar(),
        );
        expect(belowCaps).toHaveLength(1);
        // The cap patch: 10 along the axis over the arc y ∈ [-5, 5] — 100·2·asin(0.5) ≈ 104.72.
        expect(belowCaps[0].area()).toBeCloseTo(100 * (2 * Math.asin(0.5)), 0);

        // Sweeping DOWN from z=50 (reverse), the cap conforms to the cylinder's top half:
        // z = 30 + sqrt(100 - 25) ≈ 38.66 at the rims.
        const topSketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: new XYZ({ x: 0, y: 0, z: 50 }), normal: XYZ.unitZ, xvec: XYZ.unitX }),
            data: rect(5, -5, 15, 5),
        });
        doc.modelManager.addNode(topSketch);
        const fromAbove = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: topSketch.id,
                    depth: 10,
                    endCondition: "upToFace",
                    endFace,
                    reverse: true,
                },
            ],
        });
        doc.modelManager.addNode(fromAbove);
        expect(errors(fromAbove)).toEqual([undefined]);
        expect(boundsOf(fromAbove).min.z).toBeCloseTo(30 + Math.sqrt(75), 1);

        // Joined onto the cylinder, the conforming cap meets the surface exactly: the fused
        // volume adds the prism's whole column (a pass-through would overlap it away, a
        // tangent plane would shave the corners under the surface).
        const bossSketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(5, -5, 15, 5) });
        doc.modelManager.addNode(bossSketch);
        cylinder.setFeaturesEmitShapeChanged([
            ...cylinder.features,
            {
                id: "e2",
                type: "extrude",
                sketchId: bossSketch.id,
                depth: 10,
                endCondition: "upToFace",
                endFace,
                operation: "fuse",
            } as FeatureData,
        ]);
        expect(errors(cylinder)).toEqual([undefined, undefined]);
        // The conforming prism is the tangent column (2000) plus the corners between the
        // tangent plane and the surface (10·∫₋₅⁵(10−√(100−y²))dy ≈ 43.39) — all OUTSIDE the
        // cylinder, meeting it exactly at the cap: the fuse adds the whole prism.
        expect(cylinder.shape.unchecked()!.volume()).toBeCloseTo(Math.PI * 100 * 30 + 2043.39, 0);
        // The fused body is still trackable: the prism's bottom and side faces take the
        // boss sketch's seeds and the cylinder's own faces keep theirs. (The conforming
        // cap itself is consumed — it is internal to the fused solid.)
        const faceIds = facesOf(cylinder).map((_, index) => cylinder.faceIdAt(index));
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
        const bossPrefix = `sketch:${bossSketch.id}:`;
        // Bottom + four sides of the prism.
        expect(faceIds.filter((id) => id?.startsWith(bossPrefix))).toHaveLength(5);
    });

    /** The parameters the conforming build cannot express fall back to the tangent plane. */
    test.each([
        { name: "a nonzero endOffset", extra: { endOffset: 5 }, expectedTop: 25 },
        // The end lands ON the target whatever the start offset — the tangent plane here.
        { name: "a nonzero startOffset", extra: { startOffset: 2 }, expectedTop: 20 },
        { name: "a symmetric sweep", extra: { symmetric: true }, expectedTop: 20 },
        { name: "a draft", extra: { draftAngle: 3 }, expectedTop: 20 },
    ])("upToFace onto a cylinder with $name stops at the near-side plane", ({ extra, expectedTop }) => {
        const doc = scene();
        const cylinderSketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY }),
            data: circle(0, 30, 10),
        });
        doc.modelManager.addNode(cylinderSketch);
        const cylinder = new ParametricBodyNode({
            document: doc,
            features: [{ id: "e1", type: "extrude", sketchId: cylinderSketch.id, depth: 30 }],
        });
        doc.modelManager.addNode(cylinder);
        expect(cylinder.shape.isOk).toBe(true);
        const side = facesOf(cylinder).find((face) => !face.surface().isPlanar())!;
        const sideId = cylinder.faceIdAt(facesOf(cylinder).indexOf(side));
        const endFace = {
            nodeId: cylinder.id,
            profile: captureProfileRef(side, sideId, cylinder.faceIdIsShared(sideId), true),
        };
        const body = plate(doc, rect(5, -5, 15, 5), 10, { endCondition: "upToFace", endFace, ...extra });
        expect(errors(body)).toEqual([undefined]);
        expect(boundsOf(body).max.z).toBeCloseTo(expectedTop, 1);
        // The cap is the profile's own plane — no cylindrical patch anywhere.
        const caps = (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).filter(
            (face) => !face.surface().isPlanar(),
        );
        expect(caps).toHaveLength(0);
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

    test("an up-to target behind the start plane auto-reverses to reach it", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 10, 10), 10, {
            endCondition: "upToVertex",
            endVertex: { nodeId: "deleted-node", vertex: { point: { x: 5, y: 5, z: -10 } } },
        });

        // No `reverse`, no error: the sweep flips toward the target by itself.
        expect(errors(body)).toEqual([undefined]);
        const bounds = boundsOf(body);
        expect(bounds.min.z).toBeCloseTo(-10, 1);
        expect(bounds.max.z).toBeCloseTo(0, 1);
    });

    test("upToFace onto a face the start plane crosses is a rebuild error", () => {
        const doc = scene();
        const { endFace } = axisCylinder(doc);

        // The sketch plane (z=30) cuts through the cylinder's side (z∈[20,40]): no sweep
        // direction reaches only a near side, and auto-reversal cannot pick one.
        const sketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: new XYZ({ x: 0, y: 0, z: 30 }), normal: XYZ.unitZ, xvec: XYZ.unitX }),
            data: rect(5, -5, 15, 5),
        });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch.id,
                    depth: 10,
                    endCondition: "upToFace",
                    endFace,
                },
            ],
        });
        doc.modelManager.addNode(body);

        expect(body.shape.isOk).toBe(false);
        expect(errors(body)).toEqual(["Extrude target lies on or crosses the start plane"]);
    });

    test("upToFace with an oblique sweep reads the cylinder's own reach, not its box's", () => {
        // The reach samples lie ON the surface. The side's bounding-box corner nearest the
        // tilted start plane sits BEHIND it while the whole surface is ahead — box corners
        // as samples reported a crossing that is not there.
        const doc = scene();
        const { endFace } = axisCylinder(doc);
        const normal = new XYZ(1, 1, 1).normalize()!;
        // n·P0 = 8: the side's true nearest reach along n is (30 − 10√2)/√3 − 8 ≈ 1.16
        // ahead, while its bbox corner at (0, −10, 20) reaches 10/√3 − 8 ≈ −2.23 — behind.
        const origin = new XYZ(0, 0, 8 * Math.sqrt(3));
        const sketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin, normal, xvec: new XYZ(1, -1, 0).normalize()! }),
            data: rect(-2, -2, 2, 2),
        });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch.id,
                    depth: 10,
                    endCondition: "upToFace",
                    endFace,
                },
            ],
        });
        doc.modelManager.addNode(body);

        expect(errors(body)).toEqual([undefined]);
        // The cap is parallel to the profile plane, so every vertex's reach along n tops
        // out at the depth: the sampled near reach (true 1.156 + the rim-sampling slack).
        const vertices = body.shape.unchecked()!.findSubShapes(ShapeTypes.vertex) as IVertex[];
        const depth = Math.max(...vertices.map((v) => normal.dot(v.point().sub(origin))));
        expect(depth).toBeGreaterThan(1.15);
        expect(depth).toBeLessThan(1.3);
    });

    test("upToFace wholly behind an oblique start plane auto-reverses onto it", () => {
        // The same reading from the other side: every surface point lies behind the plane
        // along n, but a bbox corner reaches +1.19 ahead — corner samples read that as
        // "crossing" and failed instead of reversing.
        const doc = scene();
        const { endFace } = axisCylinder(doc);
        const normal = new XYZ(1, 1, 1).normalize()!;
        // n·P0 = 45: the side's farthest reach along n is (60 + 10√2)/√3 − 45 ≈ −2.19.
        const origin = new XYZ(0, 0, 45 * Math.sqrt(3));
        const sketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin, normal, xvec: new XYZ(1, -1, 0).normalize()! }),
            data: rect(-2, -2, 2, 2),
        });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch.id,
                    depth: 10,
                    endCondition: "upToFace",
                    endFace,
                },
            ],
        });
        doc.modelManager.addNode(body);

        expect(errors(body)).toEqual([undefined]);
        // Auto-reversed: the cap leads the plane along −n by the sampled far reach.
        const vertices = body.shape.unchecked()!.findSubShapes(ShapeTypes.vertex) as IVertex[];
        const depth = Math.max(...vertices.map((v) => -normal.dot(v.point().sub(origin))));
        expect(depth).toBeGreaterThan(2.18);
        expect(depth).toBeLessThan(2.32);
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

    test("an up-to target outranks an explicit reverse", () => {
        const doc = scene();
        const body = plate(doc, rect(0, 0, 10, 10), 10, {
            endCondition: "upToVertex",
            endVertex: { nodeId: "deleted-node", vertex: { point: { x: 5, y: 5, z: 10 } } },
            reverse: true,
        });

        // The flipped direction misses the target, so the sweep auto-reverses back to it.
        expect(errors(body)).toEqual([undefined]);
        const bounds = boundsOf(body);
        expect(bounds.min.z).toBeCloseTo(0, 1);
        expect(bounds.max.z).toBeCloseTo(10, 1);
    });

    test("upToFace auto-reverses onto a cylinder from the far side, cap conforming", () => {
        const doc = scene();
        const { endFace } = axisCylinder(doc);

        // From z=50 WITHOUT reverse: the natural direction misses the cylinder entirely,
        // so the sweep auto-reverses and the cap conforms to the cylinder's top half —
        // the build the `reverse` checkbox reaches in the direction test above.
        const topSketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: new XYZ({ x: 0, y: 0, z: 50 }), normal: XYZ.unitZ, xvec: XYZ.unitX }),
            data: rect(5, -5, 15, 5),
        });
        doc.modelManager.addNode(topSketch);
        const fromAbove = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: topSketch.id,
                    depth: 10,
                    endCondition: "upToFace",
                    endFace,
                },
            ],
        });
        doc.modelManager.addNode(fromAbove);

        expect(errors(fromAbove)).toEqual([undefined]);
        expect(boundsOf(fromAbove).min.z).toBeCloseTo(30 + Math.sqrt(75), 1);
        // The until surface's seam runs along the cylinder's TOP, so the cap patch straddles
        // it and the boolean split it in two — together the halves are the same patch as the
        // one-piece cap below (area 100·2·asin(0.5) ≈ 104.72), and the naming contract leaves
        // both id-less rather than colliding on one `:top` (see `seedTopFace`).
        const caps = (fromAbove.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).filter(
            (face) => !face.surface().isPlanar(),
        );
        expect(caps).toHaveLength(2);
        expect(caps[0].area() + caps[1].area()).toBeCloseTo(100 * (2 * Math.asin(0.5)), 0);
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

/**
 * A radius-10 cylinder extruded 30 along +X, its axis at (y=0, z=30) (the sketch plane's
 * local Y is world Z), plus its cylindrical SIDE face as an up-to-face pick.
 */
function axisCylinder(doc: TestDocument): {
    cylinder: ParametricBodyNode;
    endFace: { nodeId: string; profile: ProfileRef };
} {
    const cylinderSketch = new SketchNode({
        document: doc,
        plane: new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY }),
        data: circle(0, 30, 10),
    });
    doc.modelManager.addNode(cylinderSketch);
    const cylinder = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: cylinderSketch.id, depth: 30 }],
    });
    doc.modelManager.addNode(cylinder);
    expect(cylinder.shape.isOk).toBe(true);
    const cylinderFaces = facesOf(cylinder);
    const sideIndex = cylinderFaces.findIndex((face) => !face.surface().isPlanar());
    expect(sideIndex).toBeGreaterThanOrEqual(0);
    const sideId = cylinder.faceIdAt(sideIndex);
    const endFace = {
        nodeId: cylinder.id,
        profile: captureProfileRef(cylinderFaces[sideIndex], sideId, cylinder.faceIdIsShared(sideId), true),
    };
    return { cylinder, endFace };
}

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
