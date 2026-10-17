// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Matrix4, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef, type EdgeRef } from "../src/features/edgeRef";
import type { FeatureData, PrimitiveFeatureData } from "../src/features/feature";
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

const round = (x: number) => Math.round(x * 1e6) / 1e6 || 0; // `|| 0` folds -0 into +0
const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const edgesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const boundsOf = (body: ParametricBodyNode) => body.shape.unchecked()!.boundingBox();
const faceIdsOf = (body: ParametricBodyNode) => facesOf(body).map((_, i) => body.faceIdAt(i));

function scene() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

/** A body whose chain is exactly the given primitive features. */
function body(doc: TestDocument, features: PrimitiveFeatureData[]): ParametricBodyNode {
    const node = new ParametricBodyNode({ document: doc, features: features as FeatureData[] });
    doc.modelManager.addNode(node);
    return node;
}

/** One extruded plate body in `doc`, serving as the direction-override axle. */
function axle(doc: TestDocument): ParametricBodyNode {
    const sketchData: SketchData = {
        entities: [
            { id: 1, type: "line", params: [-1, -1, 1, -1] },
            { id: 2, type: "line", params: [1, -1, 1, 1] },
            { id: 3, type: "line", params: [1, 1, -1, 1] },
            { id: 4, type: "line", params: [-1, 1, -1, -1] },
        ],
        constraints: [],
    };
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: sketchData });
    doc.modelManager.addNode(sketch);
    const node = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 50 }],
    });
    doc.modelManager.addNode(node);
    return node;
}

/** The axle's bottom edge running along +X (y = −1, z = 0), as the direction pick stores it. */
function xEdgeRef(axle: ParametricBodyNode): EdgeRef {
    const edges = edgesOf(axle);
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

describe("primitive feature (real kernel)", () => {
    test("the four kinds build with their volumes and bounds", () => {
        const doc = scene();
        const box = body(doc, [{ id: "f1", type: "primitive", primitive: "box", dx: 10, dy: 20, dz: 30 }]);
        const cylinder = body(doc, [
            { id: "f1", type: "primitive", primitive: "cylinder", radius: 5, height: 10 },
        ]);
        const sphere = body(doc, [{ id: "f1", type: "primitive", primitive: "sphere", radius: 5 }]);
        const cone = body(doc, [
            { id: "f1", type: "primitive", primitive: "cone", radius: 5, radius2: 2, height: 10 },
        ]);

        expect(errors(box)).toEqual([undefined]);
        expect(round(box.shape.unchecked()!.volume())).toBe(6000);
        expect(boundsOf(box).max.z).toBeCloseTo(30, 1);

        expect(errors(cylinder)).toEqual([undefined]);
        expect(round(cylinder.shape.unchecked()!.volume())).toBe(round(Math.PI * 25 * 10));

        expect(errors(sphere)).toEqual([undefined]);
        expect(round(sphere.shape.unchecked()!.volume())).toBe(round((Math.PI * 500) / 3));

        expect(errors(cone)).toEqual([undefined]);
        // The frustum volume: h·π/3 · (r₁² + r₁r₂ + r₂²).
        expect(round(cone.shape.unchecked()!.volume())).toBe(round((Math.PI * 10 * (25 + 10 + 4)) / 3));
    });

    test("a box's faces are named by frame side, and the names survive a size edit", () => {
        const doc = scene();
        const node = body(doc, [{ id: "f1", type: "primitive", primitive: "box", dx: 10, dy: 20, dz: 30 }]);

        const before = faceIdsOf(node).sort();
        expect(before).toEqual([
            "prim:f1:+x",
            "prim:f1:+y",
            "prim:f1:+z",
            "prim:f1:-x",
            "prim:f1:-y",
            "prim:f1:-z",
        ]);
        // Every edge joins two named faces, so all twelve are named after them.
        const edgeIds = edgesOf(node).map((_, i) => node.edgeIdAt(i));
        expect(edgeIds.filter((id) => id === undefined)).toEqual([]);
        expect(edgeIds[0]).toContain("prim:f1:");

        node.setFeaturesEmitShapeChanged(
            node.features.map((f): FeatureData => (f.type === "primitive" ? { ...f, dx: 20 } : f)),
        );
        expect(errors(node)).toEqual([undefined]);
        expect(faceIdsOf(node).sort()).toEqual(before);
        expect(round(node.shape.unchecked()!.volume())).toBe(12000);
    });

    test("a cylinder names its caps and wall, and never the seam", () => {
        const doc = scene();
        const node = body(doc, [
            { id: "f1", type: "primitive", primitive: "cylinder", radius: 5, height: 10 },
        ]);

        expect(faceIdsOf(node).sort()).toEqual(["prim:f1:bottom", "prim:f1:lateral", "prim:f1:top"]);
        const edgeIds = edgesOf(node).map((_, i) => node.edgeIdAt(i));
        expect(edgeIds.filter((id) => id !== undefined).sort()).toEqual([
            "prim:f1:bottom&prim:f1:lateral",
            "prim:f1:lateral&prim:f1:top",
        ]);
        // The third edge is the seam — the same face on both sides, so it stays unnamed.
        expect(edgeIds.filter((id) => id === undefined)).toHaveLength(1);
    });

    test("a sphere names its one face and leaves its seam unnamed", () => {
        const doc = scene();
        const node = body(doc, [{ id: "f1", type: "primitive", primitive: "sphere", radius: 5 }]);

        expect(faceIdsOf(node)).toEqual(["prim:f1:sphere"]);
        // Seam plus the two degenerate pole edges: all border only the sphere's own face.
        const edgeIds = edgesOf(node).map((_, i) => node.edgeIdAt(i));
        expect(edgeIds).toHaveLength(3);
        expect(edgeIds).toEqual([undefined, undefined, undefined]);
    });

    test("a pointed cone is two faces, its apex edge unnamed", () => {
        const doc = scene();
        const node = body(doc, [
            { id: "f1", type: "primitive", primitive: "cone", radius: 5, radius2: 0, height: 10 },
        ]);

        expect(errors(node)).toEqual([undefined]);
        expect(round(node.shape.unchecked()!.volume())).toBe(round((Math.PI * 250) / 3));
        expect(faceIdsOf(node).sort()).toEqual(["prim:f1:bottom", "prim:f1:lateral"]);
        // The bottom rim is named; the degenerate apex edge (when the kernel reports one) is not.
        const named = edgesOf(node).filter((_, i) => node.edgeIdAt(i) !== undefined);
        expect(named).toHaveLength(1);
    });

    test("a primitive fused mid-chain keeps its ids across an upstream edit", () => {
        const doc = scene();
        const node = body(doc, [
            { id: "f1", type: "primitive", primitive: "box", dx: 20, dy: 20, dz: 10 },
            {
                id: "f2",
                type: "primitive",
                primitive: "cylinder",
                origin: { x: 10, y: 10, z: 2 },
                radius: 4,
                height: 25,
                operation: "fuse",
            },
        ]);

        expect(errors(node)).toEqual([undefined, undefined]);
        // The box plus the cylinder's reach above it (the base stands inside the box).
        expect(round(node.shape.unchecked()!.volume())).toBe(round(20 * 20 * 10 + Math.PI * 16 * 17));
        const before = faceIdsOf(node).sort();
        expect(before.some((id) => id?.startsWith("prim:f2:"))).toBe(true);

        node.setFeaturesEmitShapeChanged(
            node.features.map(
                (f): FeatureData => (f.id === "f1" && f.type === "primitive" ? { ...f, dz: 5 } : f),
            ),
        );
        expect(errors(node)).toEqual([undefined, undefined]);
        expect(faceIdsOf(node).sort()).toEqual(before);
        expect(round(node.shape.unchecked()!.volume())).toBe(round(20 * 20 * 5 + Math.PI * 16 * 22));
    });

    test("the direction override tilts the primitive and follows the source's transform", () => {
        const doc = scene();
        const axleBody = axle(doc);
        const direction = { nodeId: axleBody.id, edge: xEdgeRef(axleBody) };
        // Pitch the source 45° about Y BEFORE the body first reads the edge: the stored
        // local-frame ref re-matches on the axle and the world direction comes out tilted.
        axleBody.transform = Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, Math.PI / 4);
        const node = body(doc, [
            { id: "f1", type: "primitive", primitive: "cylinder", radius: 3, height: 15, direction },
        ]);

        expect(errors(node)).toEqual([undefined]);
        // The live match re-anchored the stored ref (the id channel is what follows the axle).
        expect((node.features[0] as PrimitiveFeatureData).direction?.edge.edgeId).toBeDefined();
        // The axis runs (+1/√2, 0, −1/√2): the far cap's center sits 15 along it, and each rim
        // reaches another radius/√2 along x and z — (15 + 3)/√2 either way.
        const tilted = boundsOf(node);
        expect(tilted.max.x).toBeCloseTo(18 / Math.SQRT2, 1);
        expect(tilted.min.z).toBeCloseTo(-18 / Math.SQRT2, 1);
        expect(round(node.shape.unchecked()!.volume())).toBe(round(Math.PI * 9 * 15));

        // Follow the source to a full right angle: the cylinder now grows straight down.
        axleBody.transform = Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, Math.PI / 2);
        expect(errors(node)).toEqual([undefined]);
        const upright = boundsOf(node);
        expect(upright.min.z).toBeCloseTo(-15, 1);
        expect(upright.max.x).toBeCloseTo(3, 1);
        expect(round(node.shape.unchecked()!.volume())).toBe(round(Math.PI * 9 * 15));
    });

    test("the stored axis builds the primitive along it when no direction override stands", () => {
        const doc = scene();
        // A cylinder told to grow along −Z hangs below its base centre — and its cap tags
        // follow the frame (`bottom` is the face whose normal points against the axis).
        const down = body(doc, [
            {
                id: "f1",
                type: "primitive",
                primitive: "cylinder",
                radius: 3,
                height: 15,
                axis: { x: 0, y: 0, z: -1 },
            },
        ]);
        expect(errors(down)).toEqual([undefined]);
        expect(round(down.shape.unchecked()!.volume())).toBe(round(Math.PI * 9 * 15));
        const downBounds = boundsOf(down);
        expect(downBounds.min.z).toBeCloseTo(-15, 1);
        expect(downBounds.max.z).toBeCloseTo(0, 1);
        expect(faceIdsOf(down).sort()).toEqual(["prim:f1:bottom", "prim:f1:lateral", "prim:f1:top"]);

        // A box on +X rises along +X; the frame's x is −Y and its y is −Z, so the base
        // rectangle grows into −y/−z from the origin corner.
        const box = body(doc, [
            {
                id: "f1",
                type: "primitive",
                primitive: "box",
                dx: 10,
                dy: 20,
                dz: 30,
                axis: { x: 1, y: 0, z: 0 },
            },
        ]);
        expect(errors(box)).toEqual([undefined]);
        const boxBounds = boundsOf(box);
        expect(boxBounds.min.x).toBeCloseTo(0, 1);
        expect(boxBounds.max.x).toBeCloseTo(30, 1);
        expect(boxBounds.min.y).toBeCloseTo(-10, 1);
        expect(boxBounds.min.z).toBeCloseTo(-20, 1);
        expect(faceIdsOf(box).sort()).toEqual([
            "prim:f1:+x",
            "prim:f1:+y",
            "prim:f1:+z",
            "prim:f1:-x",
            "prim:f1:-y",
            "prim:f1:-z",
        ]);
    });
});
