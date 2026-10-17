// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { FeatureData, HoleFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { captureFaceRef } from "../src/sketch/planeRef";
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

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const faceIdsOf = (body: ParametricBodyNode) => facesOf(body).map((_, i) => body.faceIdAt(i));
const topIndex = (faces: readonly IFace[]) => faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);

/**
 * The plate a hole is drilled into: a 40×40×20 extrusion whose top face (z = 20, normal +Z)
 * the hole ref names. The face's sketch-plane frame is origin (0,0,20), x = +X, y = +Y, so a
 * stored (u, v) is simply the world (x, y) on that face.
 */
function plate() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketchNode = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, -20, 20, 20) });
    doc.modelManager.addNode(sketchNode);
    const profiles = sketchNode.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketchNode.id,
                depth: 20,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    const faces = facesOf(body);
    const index = topIndex(faces);
    return { doc, body, top: { face: faces[index], id: body.faceIdAt(index) } };
}

/** Appends the hole feature, drilling the plate's top face at the given (u, v) centers. */
function withHole(built: ReturnType<typeof plate>, patch: Partial<HoleFeatureData> = {}): ParametricBodyNode {
    const { body, top } = built;
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "h1",
            type: "hole",
            face: { ...captureFaceRef(body.id, top.face), faceId: top.id },
            points: [[8, 8]],
            style: "simple",
            diameter: 5,
            ...patch,
        } satisfies HoleFeatureData,
    ]);
    return body;
}

const setHole = (body: ParametricBodyNode, patch: Partial<HoleFeatureData>) =>
    body.setFeaturesEmitShapeChanged(
        body.features.map((f): FeatureData => (f.id === "h1" && f.type === "hole" ? { ...f, ...patch } : f)),
    );

const PLATE_VOLUME = 40 * 40 * 20;
/** Drill tip height of a 5 mm hole at the default 118° point: r / tan(φ/2). */
const TIP = 2.5 / Math.tan((118 / 2 / 180) * Math.PI);
/** The material a blind 5 mm hole of depth D removes: the cylinder plus the tip cone. */
const blindRemoved = (depth: number, radius = 2.5, tip = TIP) =>
    Math.PI * radius * radius * (depth - tip) + (Math.PI * radius * radius * tip) / 3;

describe("hole geometry", () => {
    test("a through-all hole removes exactly the full-diameter cylinder", () => {
        const body = withHole(plate());

        expect(errors(body)).toEqual([undefined, undefined]);
        // The full-diameter part exits the far side; the tip pokes out like a real drill's,
        // so what leaves the plate is the clean cylinder and nothing else.
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - Math.PI * 2.5 * 2.5 * 20));
        expect(faceIdsOf(body)).toContain("hole:h1:0:wall");
    });

    test("a blind hole removes the cylinder to the shoulder plus the tip cone", () => {
        const body = withHole(plate(), { depth: 12 });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - blindRemoved(12)));
        expect(faceIdsOf(body)).toEqual(expect.arrayContaining(["hole:h1:0:wall", "hole:h1:0:point"]));
    });

    test("a counterbore adds its step and names every face it builds", () => {
        const body = withHole(plate(), {
            depth: 12,
            style: "counterbore",
            counterbore: { diameter: 9, depth: 3 },
        });

        expect(errors(body)).toEqual([undefined, undefined]);
        // The recess cylinder, then the hole cylinder below it, then the tip cone.
        const removed = Math.PI * 4.5 * 4.5 * 3 + blindRemoved(12 - 3);
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - removed));
        expect(faceIdsOf(body)).toEqual(
            expect.arrayContaining([
                "hole:h1:0:cboreWall",
                "hole:h1:0:cboreFloor",
                "hole:h1:0:wall",
                "hole:h1:0:point",
            ]),
        );
    });

    test("a countersink adds its cone and names it", () => {
        const body = withHole(plate(), {
            depth: 12,
            style: "countersink",
            countersink: { diameter: 10, angle: 90 },
        });

        expect(errors(body)).toEqual([undefined, undefined]);
        // The 90° cone of R = 5 down to r = 2.5 is k = (R − r)/tan(45°) = 2.5 tall — a frustum.
        const k = 2.5;
        const frustum = (Math.PI * k * (5 * 5 + 5 * 2.5 + 2.5 * 2.5)) / 3;
        const removed = frustum + blindRemoved(12 - k);
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - removed));
        expect(faceIdsOf(body)).toEqual(
            expect.arrayContaining(["hole:h1:0:csk", "hole:h1:0:wall", "hole:h1:0:point"]),
        );
    });

    test("several holes cut in one feature, each with its own ids", () => {
        const body = withHole(plate(), {
            points: [
                [8, 8],
                [-8, 8],
                [0, -8],
            ],
        });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(
            round(PLATE_VOLUME - 3 * Math.PI * 2.5 * 2.5 * 20),
        );
        expect(faceIdsOf(body)).toEqual(
            expect.arrayContaining(["hole:h1:0:wall", "hole:h1:1:wall", "hole:h1:2:wall"]),
        );
    });
});

describe("hole ids survive edits", () => {
    test("a diameter edit rebuilds cleanly and keeps every id", () => {
        const body = withHole(plate(), { depth: 12 });
        const before = [...faceIdsOf(body)].sort();

        setHole(body, { diameter: 8 });
        expect(errors(body)).toEqual([undefined, undefined]);
        const tip = 4 / Math.tan((59 / 180) * Math.PI);
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - blindRemoved(12, 4, tip)));
        // The ids name the construction, not the measurements, so the set is unchanged.
        expect([...faceIdsOf(body)].sort()).toEqual(before);
    });

    test("a depth edit keeps the ids too", () => {
        const body = withHole(plate(), { depth: 12 });
        const before = [...faceIdsOf(body)].sort();

        setHole(body, { depth: 15 });
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - blindRemoved(15)));
        expect([...faceIdsOf(body)].sort()).toEqual(before);
    });
});

describe("holes follow their face", () => {
    test("raising the plate carries the hole along", () => {
        const body = withHole(plate(), { depth: 12 });
        const wallOf = () => {
            const index = faceIdsOf(body).indexOf("hole:h1:0:wall");
            expect(index).toBeGreaterThanOrEqual(0);
            return facesOf(body)[index];
        };
        expect(wallOf().boundingBox().max.z).toBeCloseTo(20);

        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (f): FeatureData => (f.id === "e1" && f.type === "extrude" ? { ...f, depth: 30 } : f),
            ),
        );
        expect(errors(body)).toEqual([undefined, undefined]);
        // The face moved up 10 and the (u, v) centers moved with it: the same hole, higher.
        expect(wallOf().boundingBox().max.z).toBeCloseTo(30);
        expect(round(body.shape.unchecked()!.volume())).toBe(
            round(PLATE_VOLUME + 40 * 40 * 10 - blindRemoved(12)),
        );
        expect(faceIdsOf(body)).toContain("hole:h1:0:wall");
    });

    test("a lost face builds from the frozen fingerprint and says so", () => {
        const built = plate();
        const { body } = built;
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "h1",
                type: "hole",
                // No face of the plate has this normal, and there is no faceId — the frozen
                // normal+offset plane is all the feature has left.
                face: {
                    nodeId: body.id,
                    normal: { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) },
                    offset: 100,
                },
                points: [[8, 8]],
                style: "simple",
                diameter: 5,
                depth: 12,
            } satisfies HoleFeatureData,
        ]);

        // The rebuild still succeeds — the hole is drilled from the frozen plane, into thin air
        // here, so the plate itself is untouched.
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(PLATE_VOLUME);
        // ...but the row reports the lost pick: key and slot, the re-pick's door.
        expect(body.featureItems()[1].missingInputs).toEqual([
            expect.objectContaining({ key: "face", refIndex: 0 }),
        ]);
    });
});

describe("holes bound to sketch points", () => {
    /**
     * A sketch of standalone points on Plane.XY — z = 0, deliberately NOT the hole face's
     * plane (z = 20): the binding projects the point onto the face along its normal.
     */
    const pointSketch = (doc: TestDocument, points: [number, number][]) => {
        const node = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: {
                entities: points.map(([x, y], i) => ({ id: i + 1, type: "point" as const, params: [x, y] })),
                constraints: [],
            },
        });
        doc.modelManager.addNode(node);
        return node;
    };

    const setPoints = (sketch: SketchNode, points: [number, number][]) =>
        (sketch.dataJson = JSON.stringify({
            entities: points.map(([x, y], i) => ({ id: i + 1, type: "point", params: [x, y] })),
            constraints: [],
        }));

    /** The xy center of the wall face of the hole in `slot` (fails the test when absent). */
    const wallCenter = (body: ParametricBodyNode, slot: number) => {
        const index = faceIdsOf(body).indexOf(`hole:h1:${slot}:wall`);
        expect(index).toBeGreaterThanOrEqual(0);
        const box = facesOf(body)[index].boundingBox();
        return new XYZ((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
    };

    test("a bound hole drills where the sketch point projects onto the face", () => {
        const built = plate();
        const sketch = pointSketch(built.doc, [[8, 8]]);
        const body = withHole(built, { points: [], sketchPoints: { sketchId: sketch.id, entityIds: [1] } });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - Math.PI * 2.5 * 2.5 * 20));
        expect(faceIdsOf(body)).toContain("hole:h1:0:wall");
        const center = wallCenter(body, 0);
        expect(center.x).toBeCloseTo(8);
        expect(center.y).toBeCloseTo(8);
    });

    test("moving the sketch point moves the hole; moving it off the plate leaves the plate whole", () => {
        const built = plate();
        const sketch = pointSketch(built.doc, [[8, 8]]);
        const body = withHole(built, { points: [], sketchPoints: { sketchId: sketch.id, entityIds: [1] } });
        expect(wallCenter(body, 0).x).toBeCloseTo(8);

        setPoints(sketch, [[-12, -12]]);
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - Math.PI * 2.5 * 2.5 * 20));
        const moved = wallCenter(body, 0);
        expect(moved.x).toBeCloseTo(-12);
        expect(moved.y).toBeCloseTo(-12);

        // A resolved point that misses the body is not a lost pick: nothing to report.
        setPoints(sketch, [[100, 100]]);
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(PLATE_VOLUME);
        expect(body.featureItems()[1].missingInputs).toBeUndefined();
    });

    test("a deleted point suspends its hole and reports the slot", () => {
        const built = plate();
        const sketch = pointSketch(built.doc, [[8, 8]]);
        const body = withHole(built, { points: [], sketchPoints: { sketchId: sketch.id, entityIds: [1] } });
        expect(errors(body)).toEqual([undefined, undefined]);

        setPoints(sketch, []);
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(PLATE_VOLUME);
        expect(body.featureItems()[1].missingInputs).toEqual([
            expect.objectContaining({ key: "sketchPoints", refIndex: 0 }),
        ]);
    });

    test("a lost bound point leaves the survivors' ids untouched", () => {
        const built = plate();
        const sketch = pointSketch(built.doc, [
            [8, 8],
            [-8, -8],
        ]);
        const body = withHole(built, {
            points: [],
            sketchPoints: { sketchId: sketch.id, entityIds: [1, 2] },
        });
        expect(faceIdsOf(body)).toEqual(expect.arrayContaining(["hole:h1:0:wall", "hole:h1:1:wall"]));

        // Entity 1 deleted, entity 2 re-seated under its own id (setPoints keeps the order).
        sketch.dataJson = JSON.stringify({
            entities: [{ id: 2, type: "point", params: [-8, -8] }],
            constraints: [],
        });
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(faceIdsOf(body)).toContain("hole:h1:1:wall");
        expect(faceIdsOf(body)).not.toContain("hole:h1:0:wall");
        expect(round(body.shape.unchecked()!.volume())).toBe(round(PLATE_VOLUME - Math.PI * 2.5 * 2.5 * 20));
        expect(body.featureItems()[1].missingInputs).toEqual([
            expect.objectContaining({ key: "sketchPoints", refIndex: 0 }),
        ]);
    });

    test("raw picks and bound points drill side by side, each under its own slot", () => {
        const built = plate();
        const sketch = pointSketch(built.doc, [[-8, -8]]);
        const body = withHole(built, {
            points: [[5, 5]],
            sketchPoints: { sketchId: sketch.id, entityIds: [1] },
        });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(
            round(PLATE_VOLUME - 2 * Math.PI * 2.5 * 2.5 * 20),
        );
        expect(faceIdsOf(body)).toEqual(expect.arrayContaining(["hole:h1:0:wall", "hole:h1:1:wall"]));
        // The raw pick is slot 0 at (5, 5); the bound point follows at slot 1, (−8, −8).
        expect(wallCenter(body, 0).x).toBeCloseTo(5);
        expect(wallCenter(body, 1).x).toBeCloseTo(-8);
    });
});
