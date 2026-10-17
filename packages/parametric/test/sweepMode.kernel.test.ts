// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, type IShape, Plane, ShapeTypes, XYZ } from "@chili3d/core";
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

const round = (value: number) => {
    const r = Math.round(value * 1e6) / 1e6;
    return r === 0 ? 0 : r;
};

const bboxOf = (shape: IShape) => {
    const b = shape.boundingBox();
    return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(round);
};

/**
 * A quarter-arc path in the XY plane from (10,0,0) to (0,10,0), and a 4x2 rect profile
 * at (10,0,0) perpendicular to the start tangent (+y there), spanning x by 4 and z by 2.
 */
function arcPathAndProfile(factory: ShapeFactory) {
    const arc = factory.arc({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 90);
    expect(arc.isOk).toBe(true);
    const wire = factory.wire([arc.value]);
    expect(wire.isOk).toBe(true);
    const plane = new Plane({ origin: new XYZ(10, 0, 0), normal: XYZ.unitY, xvec: XYZ.unitX });
    const rect = factory.rect(plane, 4, 2);
    expect(rect.isOk).toBe(true);
    return { path: wire.value, profile: rect.value };
}

describe("sweep profile modes at the kernel boundary (real kernel)", () => {
    // A PLANAR path decides nothing: its Frenet binormal is the constant plane normal, so all
    // three frames coincide and the swept solids must come out identical.
    test("a planar arc sweeps identically in every mode", () => {
        const factory = new ShapeFactory();
        const boxes = (["frenet", "correctedFrenet", "fixed"] as const).map((mode) => {
            const { path, profile } = arcPathAndProfile(factory);
            const swept = factory.sweepWithMode!([profile], path, mode, false, { x: 0, y: 0, z: 1 });
            expect(swept.isOk).toBe(true);
            return bboxOf((swept as any).value);
        });
        expect(boxes[1]).toEqual(boxes[0]);
        expect(boxes[2]).toEqual(boxes[0]);
    });

    // A helix winds out of any plane: corrected Frenet's smoothing and the fixed binormal
    // both bank the profile differently from the raw Frenet frame, so the bboxes MUST
    // disagree — the probe that the mode actually reaches the kernel.
    test("the modes disagree on a helix", () => {
        const factory = new ShapeFactory();
        // Half-turn helix, radius 10, pitch 40 (rises 20).
        const helix = factory.helix(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 1, y: 0, z: 0 },
            10,
            40,
            180,
        );
        expect(helix.isOk).toBe(true);
        // Profile at the helix start (10,0,0), perpendicular to the start tangent (mostly
        // +y with a +z lean from the pitch).
        const tangent = new XYZ(0, 1, 20 / (Math.PI * 10)).normalize()!;
        const plane = new Plane({
            origin: new XYZ(10, 0, 0),
            normal: tangent,
            xvec: XYZ.unitZ.cross(tangent),
        });
        const rect = factory.rect(plane, 4, 2);
        expect(rect.isOk).toBe(true);
        const boxes = (["frenet", "correctedFrenet", "fixed"] as const).map((mode) => {
            const swept = factory.sweepWithMode!([rect.value], helix.value, mode, false, {
                x: 0,
                y: 0,
                z: 1,
            });
            expect(swept.isOk).toBe(true);
            return bboxOf((swept as any).value);
        });
        expect(new Set(boxes.map((box) => box.join(","))).size).toBe(3);
    });

    test("a fixed binormal parallel to the start tangent fails gracefully", () => {
        const factory = new ShapeFactory();
        const { path, profile } = arcPathAndProfile(factory);
        // The arc's start tangent is +y — the frame collapses at the start. The release
        // build turns a raise into a module abort, so this must be a refusal, not a crash.
        const swept = factory.sweepWithMode!([profile], path, "fixed", false, { x: 0, y: 1, z: 0 });
        expect(swept.isOk).toBe(false);
        expect((swept as { error: string }).error).toContain("Failed to sweep");
    });

    test("a zero fixed direction is refused before any kernel work", () => {
        const factory = new ShapeFactory();
        const { path, profile } = arcPathAndProfile(factory);
        const swept = factory.sweepWithMode!([profile], path, "fixed", false, { x: 0, y: 0, z: 0 });
        expect(swept.isOk).toBe(false);
        expect((swept as { error: string }).error).toContain("non-zero direction");
    });
});

// ---------------------------------------------------------------------------
// Feature level: the profileControl field through the parametric body.
// ---------------------------------------------------------------------------

// The path host: a 20x20 rect extruded by 20. The picked path runs along two adjacent top
// edges: (-10,-10,20) → (10,-10,20) → (10,10,20).
const pathRect: SketchData = {
    entities: [
        { id: 1, type: "line", params: [-10, -10, 10, -10] },
        { id: 2, type: "line", params: [10, -10, 10, 10] },
        { id: 3, type: "line", params: [10, 10, -10, 10] },
        { id: 4, type: "line", params: [-10, 10, -10, -10] },
    ],
    constraints: [],
};

// The swept profile: a 6x6 square at the path start (-10,-10,20), normal along the first
// segment's tangent (+X).
const profileRect: SketchData = {
    entities: [
        { id: 1, type: "line", params: [-3, -3, 3, -3] },
        { id: 2, type: "line", params: [3, -3, 3, 3] },
        { id: 3, type: "line", params: [3, 3, -3, 3] },
        { id: 4, type: "line", params: [-3, 3, -3, -3] },
    ],
    constraints: [],
};

const PROFILE_PLANE = new Plane({
    origin: new XYZ({ x: -10, y: -10, z: 20 }),
    normal: XYZ.unitX,
    xvec: XYZ.unitY,
});

function facesOf(body: ParametricBodyNode): IFace[] {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
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

function setup(profileControl?: string) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const pathSketch = new SketchNode({ document: doc, id: "psk", plane: Plane.XY, data: pathRect });
    const profileSketch = new SketchNode({
        document: doc,
        id: "pro",
        plane: PROFILE_PLANE,
        data: profileRect,
    });
    doc.modelManager.addNode(pathSketch, profileSketch);
    const pathBody = new ParametricBodyNode({
        document: doc,
        id: "pb1",
        features: [{ id: "e1", type: "extrude", sketchId: pathSketch.id, depth: 20 }],
    });
    doc.modelManager.addNode(pathBody);
    expect(pathBody.shape.isOk).toBe(true);
    const sweep: SweepFeatureData = {
        id: "f1",
        type: "sweep",
        sketchId: profileSketch.id,
        path: {
            nodeId: pathBody.id,
            edges: [
                pathRef(pathBody, [-10, -10, 20], [10, -10, 20]),
                pathRef(pathBody, [10, -10, 20], [10, 10, 20]),
            ],
        },
        ...(profileControl === undefined
            ? {}
            : { profileControl: profileControl as SweepFeatureData["profileControl"] }),
    };
    const body = new ParametricBodyNode({ document: doc, id: "b1", features: [sweep] });
    doc.modelManager.addNode(body);
    return { doc, body };
}

/** id → face area of the body's faces, for a same-geometry comparison across modes. */
function faceSnapshot(body: ParametricBodyNode) {
    const snapshot: Record<string, number> = {};
    for (const [index, face] of facesOf(body).entries()) {
        snapshot[body.faceIdAt(index) ?? "?"] = round(face.area());
    }
    return snapshot;
}

describe("sweep profileControl through the feature (real kernel)", () => {
    test("an absent profileControl is the frenet sweep, bit for bit", () => {
        const legacy = setup();
        const explicit = setup("frenet");
        for (const body of [legacy.body, explicit.body]) {
            expect(body.shape.isOk).toBe(true);
            expect(body.featureItems().map((x) => x.error)).toEqual([undefined]);
        }
        expect(faceSnapshot(explicit.body)).toEqual(faceSnapshot(legacy.body));
    });

    test.each(["correctedFrenet", "fixed"] as const)("%s sweeps and keeps the tracked ids", (mode) => {
        const { body } = setup(mode);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined]);
        expect(body.shape.isOk).toBe(true);

        const ids = facesOf(body).map((_, index) => body.faceIdAt(index));
        // The four profile edges each sweep at least one side face; exactly one end cap.
        const sides = ids.filter((id) => id !== undefined && /:ent\d+$/.test(id));
        expect(sides.length).toBeGreaterThanOrEqual(4);
        for (const id of sides) expect(id).toMatch(/^sketch:pro:e[\d.]+:ent\d+$/);
        expect(ids.filter((id) => id?.endsWith(":cap"))).toHaveLength(1);
        // A sanity volume: two 20-long legs of a 6x6 pipe, minus the corner overlap the
        // round-corner transition fills differently per mode — just pin the magnitude.
        const volume = body.shape.unchecked()!.volume();
        expect(volume).toBeGreaterThan(36 * 30);
        expect(volume).toBeLessThan(36 * 40 + 6 * 6 * 6);
    });

    test("a hand-edited invalid profileControl token fails the feature", () => {
        const { body } = setup("spiral");
        // Reading the shape is what drives the chain's evaluation — the feature panel then
        // shows the error instead of the shape.
        expect(body.shape.isOk).toBe(false);
        const errors = body.featureItems().map((x) => x.error);
        expect(errors[0]).toContain("Invalid sweep profile control: spiral");
    });
});
