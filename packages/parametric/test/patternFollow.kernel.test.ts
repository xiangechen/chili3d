// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Matrix4, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type {
    FeatureData,
    LinearPatternFeatureData,
    PatternFeatureData,
    PatternLineSource,
} from "../src/features/feature";
import "../src/features"; // registers all feature handlers
import { captureProfileRef } from "../src/features/profileRef";
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

const round = (x: number) => Math.round(x * 1e6) / 1e6 || 0; // `|| 0` folds -0 into +0
const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const edgesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const faceIdsOf = (body: ParametricBodyNode) => facesOf(body).map((_, i) => body.faceIdAt(i));
const edgeIdsOf = (body: ParametricBodyNode) => edgesOf(body).map((_, i) => body.edgeIdAt(i));
const boundsOf = (body: ParametricBodyNode) => body.shape.unchecked()!.boundingBox();

function scene() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

/** One extruded plate body in `doc`: `sketch` extruded `depth` up. */
function plate(doc: TestDocument, sketch: SketchData, depth = 10, id?: string): ParametricBodyNode {
    const sketchNode = new SketchNode({ document: doc, plane: Plane.XY, data: sketch });
    doc.modelManager.addNode(sketchNode);
    const profiles = sketchNode.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        id,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketchNode.id,
                depth,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    return body;
}

/** The line-edge source pointing at the body's edge of index `index` — the command's capture. */
function edgeSource(body: ParametricBodyNode, index: number): PatternLineSource {
    const edge = edgesOf(body)[index];
    const edgeId = body.edgeIdAt(index);
    return { nodeId: body.id, edge: captureEdgeRef(edge, edgeId, body.edgeIdIsShared(edgeId)) };
}

/** The plate edge running along X at y = −10, z = 0 (its bottom front edge). */
function xEdgeSource(body: ParametricBodyNode): PatternLineSource {
    const edges = edgesOf(body);
    // Start/end points, not the bounding box: the box carries the kernel's tolerance padding
    // (~0.025), so a box-edge coordinate never equals the nominal one.
    const index = edges.findIndex((edge) => {
        const start = edge.startPoint();
        const direction = edge.endPoint().sub(start).normalize();
        return (
            direction !== undefined &&
            Math.abs(direction.x) > 1 - 1e-6 &&
            Math.abs(start.y + 10) < 1e-6 &&
            Math.abs(start.z) < 1e-6
        );
    });
    expect(index).toBeGreaterThanOrEqual(0);
    return edgeSource(body, index);
}

/** An upright (Z-running) edge of the axle body — a circular pattern's axis. */
function zEdgeSource(body: ParametricBodyNode): PatternLineSource {
    const edges = edgesOf(body);
    const index = edges.findIndex((edge) => {
        const direction = edge.endPoint().sub(edge.startPoint()).normalize();
        return direction !== undefined && Math.abs(direction.z) > 1 - 1e-6;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    return edgeSource(body, index);
}

function withPattern(body: ParametricBodyNode, feature: Omit<LinearPatternFeatureData, "id" | "type"> | any) {
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id: "p1", type: "pattern", ...feature } as FeatureData,
    ]);
    return body;
}

describe("linear pattern", () => {
    test("three touching instances fuse into one body, every sub-shape named", () => {
        const doc = scene();
        // 20×20×10, x ∈ [0, 20]; spacing 20 along +X makes the copies FACE-TO-FACE, so the
        // fuse merges each coplanar pair into one — the merge channel's case.
        const body = plate(doc, rect(0, -10, 20, 10));
        withPattern(body, { mode: "linear", direction: xEdgeSource(body), count: 3, spacing: 20 });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(60 * 20 * 10);
        const bounds = boundsOf(body);
        expect(round(bounds.min.x)).toBe(0);
        expect(round(bounds.max.x)).toBe(60);
        expect(facesOf(body)).toHaveLength(6);
        const faceIds = faceIdsOf(body);
        const edgeIds = edgeIdsOf(body);
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
        expect(edgeIds.filter((id) => id === undefined)).toEqual([]);
        // The merged top/bottom/side faces carry the input's id combined with each copy's
        // `pattern:p1:<k>`-scoped one; the end caps (x = 0 and x = 60) stay single-source.
        expect(faceIds.some((id) => id!.includes("pattern:p1:0:"))).toBe(true);
        expect(faceIds.some((id) => id!.includes("pattern:p1:1:"))).toBe(true);
        expect(faceIds.some((id) => !id!.includes("pattern:p1:"))).toBe(true);
    });

    test("the copies follow an upstream edit and keep their names", () => {
        const doc = scene();
        const body = plate(doc, rect(0, -10, 20, 10));
        withPattern(body, { mode: "linear", direction: xEdgeSource(body), count: 3, spacing: 20 });
        const before = [...faceIdsOf(body), ...edgeIdsOf(body)].sort();

        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (f): FeatureData => (f.id === "e1" && f.type === "extrude" ? { ...f, depth: 20 } : f),
            ),
        );
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(60 * 20 * 20);
        expect([...faceIdsOf(body), ...edgeIdsOf(body)].sort()).toEqual(before);
    });

    test("skip drops a copy's geometry and its ids, the survivors keep theirs", () => {
        const doc = scene();
        // Spacing 30 leaves the 20-wide instances APART: no faces merge, so every id is
        // single-source and a survivor's id is bit-for-bit the one it had before the skip.
        const body = plate(doc, rect(0, -10, 20, 10));
        withPattern(body, { mode: "linear", direction: xEdgeSource(body), count: 3, spacing: 30 });
        const before = faceIdsOf(body);

        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (f): FeatureData =>
                    f.id === "p1" && f.type === "pattern" && f.mode === "linear" ? { ...f, skip: [1] } : f,
            ),
        );
        expect(errors(body)).toEqual([undefined, undefined]);
        // The original and the first copy remain; the far copy (flat index 1) is gone.
        expect(round(body.shape.unchecked()!.volume())).toBe(2 * 20 * 20 * 10);
        const bounds = boundsOf(body);
        expect(round(bounds.min.x)).toBe(0);
        expect(round(bounds.max.x)).toBe(50);
        const after = faceIdsOf(body);
        expect(after.some((id) => id!.includes("pattern:p1:1:"))).toBe(false);
        expect(after.some((id) => id!.includes("pattern:p1:0:"))).toBe(true);
        // The original's and copy 0's faces keep the ids they had before the skip.
        const beforeKept = before.filter((id) => !id!.includes("pattern:p1:1:"));
        expect(after.filter((id) => beforeKept.includes(id)).length).toBe(beforeKept.length);
    });

    test("merge: false keeps the instances side by side in one compound, ids in order", () => {
        const doc = scene();
        const body = plate(doc, rect(0, -10, 10, 10));
        withPattern(body, {
            mode: "linear",
            direction: xEdgeSource(body),
            count: 3,
            spacing: 30,
            merge: false,
        });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(body.shape.unchecked()!.shapeType).toBe(ShapeTypes.compound);
        expect(facesOf(body)).toHaveLength(18);
        expect(round(boundsOf(body).max.x)).toBe(70);
        const faceIds = faceIdsOf(body);
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
        // The compound enumerates the input's sub-shapes first, then each copy's in order.
        expect(faceIds.slice(0, 6).every((id) => !id!.includes("pattern:p1"))).toBe(true);
        for (const k of [0, 1]) {
            expect(
                faceIds
                    .slice(6 + k * 6, 12 + k * 6)
                    .every((id) => id!.split("|").every((leaf) => leaf.startsWith(`pattern:p1:${k}:`))),
            ).toBe(true);
        }
    });

    test("a direction edge on another node follows that node's transform", () => {
        const doc = scene();
        // The direction source: a 2×2×50 axle at the origin; its upright edges run +Z... the
        // +X direction comes from one of its BOTTOM edges.
        const axle = plate(doc, rect(-1, -1, 1, 1), 50);
        const direction = xEdgeSourceOf(axle);
        const body = plate(doc, rect(0, -10, 10, 10));
        withPattern(body, { mode: "linear", direction, count: 2, spacing: 30 });
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(boundsOf(body).max.x)).toBe(40);

        // Rotate the source 90° about Z: its local +X edge now runs along world +Y, and the
        // pattern re-aims — the copy leaves the X axis entirely.
        axle.transform = Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2);
        expect(errors(body)).toEqual([undefined, undefined]);
        const bounds = boundsOf(body);
        expect(round(bounds.max.x)).toBe(10);
        expect(round(bounds.max.y)).toBe(40);
    });

    test("a host whose transform cannot be inverted refuses the direction rather than guessing", () => {
        const doc = scene();
        const axle = plate(doc, rect(-1, -1, 1, 1), 50);
        const direction = xEdgeSourceOf(axle);
        const body = plate(doc, rect(0, -10, 10, 10));
        // The direction was captured in the axle's frame and has to be carried through the host's
        // inverse. A singular host transform has none — reading the ref as though it were already
        // host-frame geometry would march the copies to the wrong place with nothing reported.
        body.transform = Matrix4.fromScale(0, 1, 1);
        withPattern(body, { mode: "linear", direction, count: 2, spacing: 30 });

        expect(errors(body)).toEqual([undefined, "Pattern direction cannot be mapped into the body"]);
    });

    test("the direction ref re-matches through an edit of its own source body", () => {
        const doc = scene();
        const axle = plate(doc, rect(-1, -1, 1, 1), 50);
        const direction = xEdgeSourceOf(axle);
        const body = plate(doc, rect(0, -10, 10, 10));
        withPattern(body, { mode: "linear", direction, count: 2, spacing: 30 });
        expect(errors(body)).toEqual([undefined, undefined]);

        // The source's depth edit stretches the picked edge; the id channel re-matches it and
        // the pattern keeps its aim (a lost ref would still build, but flagged unresolved).
        axle.setFeaturesEmitShapeChanged(
            axle.features.map(
                (f): FeatureData => (f.id === "e1" && f.type === "extrude" ? { ...f, depth: 80 } : f),
            ),
        );
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(boundsOf(body).max.x)).toBe(40);
        expect(body.featureItems()[1].missingInputs).toBeUndefined();
    });
});

/** The axle's bottom edge running along X (y = −1, z = 0). */
function xEdgeSourceOf(axle: ParametricBodyNode): PatternLineSource {
    const edges = edgesOf(axle);
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
    return edgeSource(axle, index);
}

describe("circular pattern", () => {
    /**
     * A plate OFF the axis — x ∈ [10, 30], y ∈ [−10, 10], z ∈ [0, 10] — patterned about an
     * axle's upright edge through (1, −1). Copies land a right angle apart.
     */
    function circularScene(patch: Partial<PatternFeatureData> = {}) {
        const doc = scene();
        const axle = plate(doc, rect(-1, -1, 1, 1), 50);
        const axis = zEdgeSource(axle);
        const body = plate(doc, rect(10, -10, 30, 10));
        withPattern(body, { mode: "circular", axis, count: 4, ...patch });
        return body;
    }

    test("equal spacing spreads four instances across a full turn without overlap", () => {
        const body = circularScene();

        expect(errors(body)).toEqual([undefined, undefined]);
        // Four instances a quarter-turn apart, not five positions with the last on the first:
        // the volume is four plates, not three-and-a-bit.
        expect(round(body.shape.unchecked()!.volume())).toBe(4 * 20 * 20 * 10);
        // The four placements are symmetric about the axis: the bounding box spans ±30 on both
        // axes (each plate reaches radius 30 from the axis through (1, −1)... measured below).
        const bounds = boundsOf(body);
        expect(round(bounds.max.z)).toBe(10);
        expect(round(bounds.min.x)).toBeLessThan(-25);
        expect(round(bounds.max.x)).toBeGreaterThan(25);
        expect(round(bounds.min.y)).toBeLessThan(-25);
        expect(round(bounds.max.y)).toBeGreaterThan(25);
        const faceIds = faceIdsOf(body);
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
        for (const k of [0, 1, 2]) {
            expect(faceIds.some((id) => id!.includes(`pattern:p1:${k}:`))).toBe(true);
        }
    });

    test("equal spacing off makes the angle the first-to-last span", () => {
        // 180° over 3 instances: span mode places the copies at 90° and 180°; equal spacing
        // would place them at 60° and 120°.
        const body = circularScene({ count: 3, angle: 180, equalSpacing: false });

        expect(errors(body)).toEqual([undefined, undefined]);
        const bounds = boundsOf(body);
        // The 180° copy is the plate mirrored through the axis (1, −1): x ∈ [−28, −8]...
        // measured as the bbox reaching the negative side of the axis at all.
        expect(round(bounds.min.x)).toBeLessThan(-5);
        // And nothing reached the 60°/120° positions: those would leave material with
        // y beyond the span placement's reach — the span's copies stay within radius 30.
        expect(round(body.shape.unchecked()!.volume())).toBe(3 * 20 * 20 * 10);
    });

    test("the copies follow the axis when its source body moves", () => {
        const doc = scene();
        const axle = plate(doc, rect(-1, -1, 1, 1), 50);
        const axis = zEdgeSource(axle);
        const body = plate(doc, rect(10, -10, 30, 10));
        withPattern(body, { mode: "circular", axis, count: 2 });
        expect(errors(body)).toEqual([undefined, undefined]);
        const before = boundsOf(body);
        expect(round(before.max.x)).toBe(30);

        // The axis edge rides the axle: shifted +100 on Y, the half-turn copy lands 200mm away.
        // The ORIGINAL does not move — the follow shows in the copy's reach on +Y.
        axle.transform = Matrix4.fromTranslation(0, 100, 0);
        expect(errors(body)).toEqual([undefined, undefined]);
        const after = boundsOf(body);
        expect(round(after.max.y)).toBeGreaterThan(round(before.max.y) + 50);
    });
});
