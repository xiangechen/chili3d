// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// ============================================================================
// Planning aid, not a certified lift plan.
// Acceptance Tests for Task M5: 3D Clearance Distance Dry Run
// Owner: Abhishek
// ============================================================================

import { type IShapeFactory, XYZ } from "@chili3d/core";
import { ShapeFactory } from "@chili3d/wasm";
import {
    computeClearanceDistance,
    createBoomCylinder,
    createBuildingBox,
    MM_PER_M,
} from "../src/clearance/distance";
import "./setup";

describe("Task M5: 3D Boom Clearance Distance Dry Run", () => {
    let factory: ShapeFactory;

    beforeEach(() => {
        factory = new ShapeFactory();
    });

    /**
     * M5 units check (CRANE-PLANNER.md rule: convert once at the plugin boundary).
     * Verify that a 40 m building dimension translates to 40,000 mm in the Chili3D CAD kernel.
     */
    test("Units test: 40 m dimension converts to 40,000 mm in the CAD scene", () => {
        // Hand calculation:
        // Input: 40 metres
        // Chili3D scale factor = 1000 mm / m
        // Expected CAD kernel dimension = 40 * 1000 = 40,000 mm
        const building = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 40, dy: 20, dz: 15 });
        const bbox = building.boundingBox();
        const lengthMm = bbox.max.x - bbox.min.x;
        expect(lengthMm).toBeCloseTo(40000, 0);
        expect(lengthMm / MM_PER_M).toBeCloseTo(40.0, 3);
    });

    /**
     * Case 1: 2.0 m separation (Safe clearance)
     *
     * Hand-worked calculation:
     * - Building Box: origin (0, 0, 0), dx = 10m, dy = 10m, dz = 20m.
     *   Occupies X in [0.0, 10.0] m (right face at X = 10.0 m = 10,000 mm).
     * - Boom Cylinder: vertical along Z, radius = 0.5 m (500 mm), length = 15m.
     *   Center positioned at (X = 12.5 m, Y = 5.0 m, Z = 0.0 m).
     *   Nearest point on cylinder surface to building:
     *   X_nearest = X_center - radius = 12.5 m - 0.5 m = 12.0 m (12,000 mm).
     * - Minimum distance:
     *   dist = 12.0 m - 10.0 m = 2.00 m (2,000 mm).
     */
    test("Case 1: reports 2.00 m (±0.1 m) separation between building and boom", () => {
        const building = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 10, dy: 10, dz: 20 });
        const boom = createBoomCylinder(factory, { x: 12.5, y: 5.0, z: 0 }, 0.5, 15);

        const result = computeClearanceDistance(building, boom, factory);

        expect(result.distanceM).toBeCloseTo(2.0, 1);
        expect(result.distanceMm).toBeCloseTo(2000, 0);
        expect(result.isCollision).toBe(false);
        expect(result.isTouching).toBe(false);
    });

    /**
     * Case 2: 0.5 m separation (Tight clearance)
     *
     * Hand-worked calculation:
     * - Building Box: X in [0.0, 10.0] m.
     * - Boom Cylinder: radius = 0.5 m.
     *   Center positioned at (X = 11.0 m, Y = 5.0 m, Z = 0.0 m).
     *   Nearest point on cylinder surface:
     *   X_nearest = 11.0 m - 0.5 m = 10.5 m (10,500 mm).
     * - Minimum distance:
     *   dist = 10.5 m - 10.0 m = 0.50 m (500 mm).
     */
    test("Case 2: reports 0.50 m (±0.1 m) separation between building and boom", () => {
        const building = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 10, dy: 10, dz: 20 });
        const boom = createBoomCylinder(factory, { x: 11.0, y: 5.0, z: 0 }, 0.5, 15);

        const result = computeClearanceDistance(building, boom, factory);

        expect(result.distanceM).toBeCloseTo(0.5, 1);
        expect(result.distanceMm).toBeCloseTo(500, 0);
        expect(result.isCollision).toBe(false);
        expect(result.isTouching).toBe(false);
    });

    /**
     * Case 3: 0.0 m separation (Touching boundary without penetrating)
     *
     * Hand-worked calculation:
     * - Building Box: X in [0.0, 10.0] m.
     * - Boom Cylinder: radius = 0.5 m.
     *   Center positioned at (X = 10.5 m, Y = 5.0 m, Z = 0.0 m).
     *   Nearest point on cylinder surface:
     *   X_nearest = 10.5 m - 0.5 m = 10.0 m (10,000 mm).
     * - Minimum distance:
     *   dist = 10.0 m - 10.0 m = 0.00 m.
     *   Cylinder touches the building facade tangentially, no penetrating volume.
     */
    test("Case 3: reports 0.00 m when boom touches the building wall", () => {
        const building = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 10, dy: 10, dz: 20 });
        const boom = createBoomCylinder(factory, { x: 10.5, y: 5.0, z: 0 }, 0.5, 15);

        const result = computeClearanceDistance(building, boom, factory);

        expect(result.distanceM).toBeCloseTo(0.0, 2);
        expect(result.distanceMm).toBeCloseTo(0.0, 1);
        expect(result.isCollision).toBe(false);
        expect(result.isTouching).toBe(true);
    });

    /**
     * Case 4: Overlap / Collision (Penetration into building volume)
     *
     * Hand-worked calculation:
     * - Building Box: X in [0.0, 10.0] m.
     * - Boom Cylinder: radius = 0.5 m.
     *   Center positioned at (X = 10.0 m, Y = 5.0 m, Z = 0.0 m).
     *   Cylinder occupies X in [9.5, 10.5] m.
     *   Since the building occupies X in [0.0, 10.0] m, the cylinder region
     *   X in [9.5, 10.0] m penetrates inside the building by 0.50 m (500 mm).
     * - Minimum distance = 0.00 m, with collision flag = true.
     */
    test("Case 4: detects overlap collision when boom penetrates building volume", () => {
        const building = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 10, dy: 10, dz: 20 });
        const boom = createBoomCylinder(factory, { x: 10.0, y: 5.0, z: 0 }, 0.5, 15);

        const result = computeClearanceDistance(building, boom, factory);

        expect(result.distanceM).toBeCloseTo(0.0, 2);
        expect(result.isCollision).toBe(true);
        expect(result.isTouching).toBe(false);
    });

    /**
     * Case 5: Boom completely INSIDE the building (no surface gap at all)
     *
     * Hand-worked calculation:
     * - Building Box: X, Y in [0, 10] m, Z in [0, 20] m.
     * - Boom Cylinder: radius = 0.5 m at (X = 5.0, Y = 5.0), length = 15 m, so it spans
     *   X, Y in [4.5, 5.5] m and Z in [0, 15] m: entirely within the box.
     * - Minimum distance = 0 and the shared volume is the whole cylinder:
     *   V = pi * 0.5^2 * 15 = 11.78 m3 > 0, so this must be a collision, not "touching".
     */
    test("Case 5: boom fully inside the building is a collision", () => {
        const building = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 10, dy: 10, dz: 20 });
        const boom = createBoomCylinder(factory, { x: 5.0, y: 5.0, z: 0 }, 0.5, 15);

        const result = computeClearanceDistance(building, boom, factory);

        expect(result.distanceM).toBeCloseTo(0.0, 2);
        expect(result.isCollision).toBe(true);
        expect(result.isTouching).toBe(false);
    });

    /**
     * Case 6: Fail safe when the boolean test cannot answer
     *
     * Hand-worked reasoning:
     * - Geometry is Case 3 (distance 0 = touching OR overlapping, the boolean decides which).
     * - If the boolean throws, we do not know it is only touching. A planning aid must not
     *   under-report a clash, so the result must be a collision, never "touching".
     */
    test("Case 6: reports a collision (not touching) when the overlap test fails", () => {
        const building = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 10, dy: 10, dz: 20 });
        const boom = createBoomCylinder(factory, { x: 10.5, y: 5.0, z: 0 }, 0.5, 15);
        const failing = {
            booleanCommon: () => {
                throw new Error("boolean failed");
            },
        } as unknown as IShapeFactory;

        const result = computeClearanceDistance(building, boom, failing);

        expect(result.isCollision).toBe(true);
        expect(result.isTouching).toBe(false);
    });

    /**
     * Case 7: INCLINED boom (every case above is vertical, M6 needs angled booms)
     *
     * Hand-worked calculation:
     * - Building Box: X, Y in [0, 10] m, Z in [0, 20] m. Its +X face is the plane X = 10 m.
     * - Boom Cylinder: radius r = 0.5 m, base centre (12.5, 5, 5) m, axis tilted 45 degrees from
     *   vertical towards +X: direction (1, 0, 1) / sqrt(2). The axis runs up and away from the
     *   building, so the cylinder point nearest the +X face is on the base-disc rim.
     * - The base disc lies in the plane spanned by (-1, 0, 1) / sqrt(2) and (0, 1, 0). Its rim point
     *   with the smallest X is the base centre + r * (-1, 0, 1) / sqrt(2):
     *   X_min = 12.5 - 0.5 / sqrt(2) = 12.5 - 0.35355 = 12.14645 m, at Y = 5 m, Z = 5.35355 m.
     *   Y and Z lie inside the face, so the nearest box point is straight across on X = 10.
     * - Minimum distance = 12.14645 - 10.0 = 2.14645 m (2,146.45 mm).
     *   A vertical boom at the same centre would give 2.00 m, so this proves the tilt is used.
     */
    test("Case 7: inclined boom (45 degrees) reports the hand-worked 2.146 m", () => {
        const building = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 10, dy: 10, dz: 20 });
        const tilt = new XYZ({ x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 });
        const boom = createBoomCylinder(factory, { x: 12.5, y: 5.0, z: 5.0 }, 0.5, 15, tilt);

        const result = computeClearanceDistance(building, boom, factory);

        expect(result.distanceM).toBeCloseTo(2.14645, 3);
        expect(result.distanceMm).toBeCloseTo(2146.45, 0);
        expect(result.isCollision).toBe(false);
        expect(result.isTouching).toBe(false);
    });
});
