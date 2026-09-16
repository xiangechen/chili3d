// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, type IShape, Line, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import { createBox, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

function faceCount(shape: IShape): number {
    return shape.findSubShapes(ShapeTypes.face).length;
}

describe("ShapeFactory — tracked (face history)", () => {
    describe("prismTracked", () => {
        test("should map output faces of an extruded rect", () => {
            const rect = unwrapOk(factory.rect(Plane.XY, 10, 20));
            const result = factory.prismTracked(rect, new XYZ({ x: 0, y: 0, z: 30 }));
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            // A box has 6 faces; the face map aligns with findSubShapes order.
            expect(result.value.faceMap.length).toBe(faceCount(result.value.shape));
            expect(result.value.faceMap.length).toBe(6);
            // The bottom face is the profile face itself (identity match).
            expect(result.value.faceMap).toContain(0);
        });

        test("should fail on a zero-length vector", () => {
            const rect = unwrapOk(factory.rect(Plane.XY, 10, 20));
            const result = factory.prismTracked(rect, XYZ.zero);
            expect(result.isOk).toBe(false);
        });

        test("should report the top face through capFaces", () => {
            const rect = unwrapOk(factory.rect(Plane.XY, 10, 20));
            const result = factory.prismTracked(rect, new XYZ({ x: 0, y: 0, z: 30 }));
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            // Exactly one cap face, and the history maps do not cover it — the same
            // face the unique-history-less heuristic used to find.
            const capFaces = result.value.capFaces ?? [];
            expect(capFaces).toHaveLength(1);
            const index = capFaces[0];
            expect(result.value.faceMap[index]).toBe(-1);
            expect(result.value.faceEdgeMap?.[index] ?? -1).toBe(-1);
            // It is the geometric top (the profile translated by the sweep vector).
            const face = result.value.shape.findSubShapes(ShapeTypes.face)[index] as IFace;
            const box = face.boundingBox();
            expect((box.min.x + box.max.x) / 2).toBeCloseTo(5);
            expect((box.min.y + box.max.y) / 2).toBeCloseTo(10);
            expect((box.min.z + box.max.z) / 2).toBeCloseTo(30);
        });

        test("should report the top face of a holed profile through capFaces", () => {
            // 20x20 rect with a circular through-hole — the hole's side face competes
            // with the top in any history-less-face heuristic.
            const corners = [
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 20, y: 0, z: 0 }),
                new XYZ({ x: 20, y: 20, z: 0 }),
                new XYZ({ x: 0, y: 20, z: 0 }),
            ];
            const lines = corners.map((start, i) =>
                unwrapOk(factory.line(start, corners[(i + 1) % corners.length])),
            );
            const outer = unwrapOk(factory.wire(lines));
            const circle = unwrapOk(factory.circle(XYZ.unitZ, new XYZ({ x: 10, y: 10, z: 0 }), 4));
            const hole = unwrapOk(factory.wire([circle]));
            const profile = unwrapOk(factory.face([outer, hole])) as IFace;
            const result = factory.prismTracked(profile, new XYZ({ x: 0, y: 0, z: 15 }));
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            const capFaces = result.value.capFaces ?? [];
            expect(capFaces).toHaveLength(1);
            const face = result.value.shape.findSubShapes(ShapeTypes.face)[capFaces[0]] as IFace;
            const box = face.boundingBox();
            expect((box.min.z + box.max.z) / 2).toBeCloseTo(15);
        });
    });

    describe("revolveTracked", () => {
        test("should map output faces of a revolved rect", () => {
            const rect = unwrapOk(factory.rect(Plane.XY, 10, 20));
            const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
            const result = factory.revolveTracked(rect, axis, 360);
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            expect(result.value.faceMap.length).toBe(faceCount(result.value.shape));
            expect(result.value.faceMap.length).toBeGreaterThan(0);
        });

        test("should report a partial revolve's end cap through capFaces", () => {
            const rect = unwrapOk(factory.rect(Plane.XY, 10, 20));
            const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
            const result = factory.revolveTracked(rect, axis, 270);
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            const capFaces = result.value.capFaces ?? [];
            expect(capFaces).toHaveLength(1);
            const index = capFaces[0];
            // The cap has no history — it is neither the identical start face nor an
            // edge-generated side face.
            expect(result.value.faceMap[index]).toBe(-1);
            expect(result.value.faceEdgeMap?.[index] ?? -1).toBe(-1);
            // The rect's center (5,10,0) rotated 270° about Z lands at (10,-5,0).
            const face = result.value.shape.findSubShapes(ShapeTypes.face)[index] as IFace;
            const box = face.boundingBox();
            expect((box.min.x + box.max.x) / 2).toBeCloseTo(10);
            expect((box.min.y + box.max.y) / 2).toBeCloseTo(-5);
            expect((box.min.z + box.max.z) / 2).toBeCloseTo(0);
        });

        test("should report no cap for a full turn (first/last shapes coincide)", () => {
            const rect = unwrapOk(factory.rect(Plane.XY, 10, 20));
            const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
            const result = factory.revolveTracked(rect, axis, 360);
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            // At exactly 360° the rings keep the geometric probe on the TS side.
            expect(result.value.capFaces ?? []).toHaveLength(0);
        });
    });

    describe("filletTracked", () => {
        test("should keep untouched faces mapped and mark the fillet face as new", () => {
            const box = createBox(factory, 10, 20, 30);
            const result = factory.filletTracked(box, [0], 2);
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            // 6 input faces + 1 fillet face
            expect(result.value.faceMap.length).toBe(7);
            const newFaces = result.value.faceMap.filter((x) => x === -1);
            expect(newFaces.length).toBe(1);
            // Untouched faces keep their identity mapping — all six input indexes appear.
            const mapped = new Set(result.value.faceMap.filter((x) => x >= 0));
            expect(mapped.size).toBe(6);
        });
    });

    describe("chamferTracked", () => {
        test("should keep untouched faces mapped and mark the chamfer face as new", () => {
            const box = createBox(factory, 10, 20, 30);
            const result = factory.chamferTracked(box, [0], 2);
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            expect(result.value.faceMap.length).toBe(7);
            const newFaces = result.value.faceMap.filter((x) => x === -1);
            expect(newFaces.length).toBe(1);
        });
    });

    describe("booleanCutTracked", () => {
        test("should map surviving input faces of a cut", () => {
            const box = createBox(factory, 10, 10, 10);
            const tool = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 2, 20));
            const result = factory.booleanCutTracked([box], [tool]);
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            expect(result.value.faceMap.length).toBe(faceCount(result.value.shape));
            // Box faces keep indexes 0-5; the cylindrical cut face traces back to the
            // tool's lateral face — tool faces are enumerated after the args (index 6+).
            expect(result.value.faceMap.some((x) => x >= 0 && x < 6)).toBe(true);
            expect(result.value.faceMap.some((x) => x >= 6)).toBe(true);
        });
    });

    describe("booleanFuseTracked", () => {
        test("should map faces of a fused pair", () => {
            const box = createBox(factory, 10, 10, 10);
            const other = unwrapOk(factory.sphere(new XYZ({ x: 5, y: 5, z: 5 }), 6));
            const result = factory.booleanFuseTracked([box], [other]);
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            expect(result.value.faceMap.length).toBe(faceCount(result.value.shape));
            expect(result.value.faceMap.some((x) => x >= 0)).toBe(true);
        });
    });

    describe("booleanCommonTracked", () => {
        test("should map faces of the common part", () => {
            const box = createBox(factory, 10, 10, 10);
            const other = unwrapOk(factory.sphere(new XYZ({ x: 5, y: 5, z: 5 }), 6));
            const result = factory.booleanCommonTracked([box], [other]);
            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            expect(result.value.faceMap.length).toBe(faceCount(result.value.shape));
        });
    });

    describe("id stability across a rebuild", () => {
        test("prism then fillet: side face ids propagate through the fillet", () => {
            const rect = unwrapOk(factory.rect(Plane.XY, 10, 20)) as IFace;
            const prism = factory.prismTracked(rect, new XYZ({ x: 0, y: 0, z: 30 }));
            expect(prism.isOk).toBe(true);
            if (!prism.isOk) return;

            // Fillet edge 0 and check which output faces trace back to the same input face.
            const fillet = factory.filletTracked(prism.value.shape, [0], 2);
            expect(fillet.isOk).toBe(true);
            if (!fillet.isOk) return;
            const fromPrism = fillet.value.faceMap.filter((x) => x >= 0);
            // Every kept face points at a valid prism face index.
            for (const index of fromPrism) {
                expect(index).toBeLessThan(prism.value.faceMap.length);
            }
            expect(fromPrism.length).toBe(6);
        });
    });
});
