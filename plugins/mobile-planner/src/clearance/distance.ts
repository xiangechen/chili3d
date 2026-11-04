// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// ============================================================================
// Planning aid, not a certified lift plan.
// Mobile Crane Lift Planner — 3D Boom Clearance Engine (Task M5)
// Owner: Abhishek
// ============================================================================

import {
    type IShape,
    type IShapeFactory,
    type ISolid,
    Plane,
    Precision,
    XYZ,
    type XYZLike,
} from "@chili3d/core";

/**
 * Result of a 3D CAD clearance distance calculation.
 * All public planning distances are expressed in METRES.
 */
export interface ClearanceResult {
    /**
     * Minimum surface-to-surface distance in metres (m).
     */
    distanceM: number;
    /**
     * Minimum distance in millimetres (CAD kernel units).
     */
    distanceMm: number;
    /**
     * True if the two solids physically penetrate/overlap each other.
     */
    isCollision: boolean;
    /**
     * True if the shapes touch at their boundaries without interior penetration.
     */
    isTouching: boolean;
}

/**
 * MM_PER_M: Conversion ratio between Chili3D kernel units (mm) and planner units (m).
 * 1 metre = 1000 millimetres.
 */
export const MM_PER_M = 1000;

/**
 * Intersection volumes below this (mm³) count as surface contact, not penetration.
 * 1 mm³ is a numerical-noise floor, not a safety margin.
 */
const MIN_OVERLAP_MM3 = 1.0;

/**
 * Computes the minimum 3D clearance distance between two shapes using
 * OpenCASCADE's BRepExtrema through the Chili3D IShape API.
 *
 * @param shapeA - First shape (e.g. Building solid)
 * @param shapeB - Second shape (e.g. Crane Boom cylinder)
 * @param factory - IShapeFactory used to tell boundary-touching from volume penetration. Required:
 *   a minimum distance of 0 means "touching OR overlapping", and without the boolean test an overlap
 *   would be reported as merely touching.
 * @returns ClearanceResult containing distance in metres and collision flags
 * @throws Error if BRepExtrema cannot compute a distance (negative result, e.g. an empty or invalid
 *   shape). No distance is guessed in that case; the caller must treat it as "distance unavailable",
 *   never as 0 and never as safe.
 */
export function computeClearanceDistance(
    shapeA: IShape,
    shapeB: IShape,
    factory: IShapeFactory,
): ClearanceResult {
    const distMm = shapeA.extremaDistance(shapeB);

    if (distMm < 0) {
        throw new Error("Unable to calculate extrema distance: shapes have no valid geometry");
    }

    const distanceM = distMm / MM_PER_M;

    // If shapes are separated (> 0 mm), there is no collision and they are not touching
    if (distMm > Precision.Distance) {
        return {
            distanceM,
            distanceMm: distMm,
            isCollision: false,
            isTouching: false,
        };
    }

    // distMm <= Precision.Distance: The shapes either touch at the boundary or overlap.
    // Evaluate booleanCommon to test for penetrating volume. Fail safe: if the boolean cannot give an
    // answer, report a collision, never "touching" (a planning aid must not under-report a clash).
    let penetrates: boolean;
    try {
        const commonResult = factory.booleanCommon([shapeA], [shapeB]);
        penetrates =
            !commonResult.isOk ||
            (!commonResult.value.isNull() && commonResult.value.volume() > MIN_OVERLAP_MM3);
    } catch {
        penetrates = true;
    }

    return {
        distanceM: 0,
        distanceMm: 0,
        isCollision: penetrates,
        isTouching: !penetrates,
    };
}

/**
 * Helper to construct an axis-aligned building box solid in metres.
 * Converts coordinates to millimetres at the Chili3D factory boundary.
 */
export function createBuildingBox(
    factory: IShapeFactory,
    originM: XYZLike,
    sizeM: { dx: number; dy: number; dz: number },
): ISolid {
    const plane = new Plane({
        origin: new XYZ({
            x: originM.x * MM_PER_M,
            y: originM.y * MM_PER_M,
            z: originM.z * MM_PER_M,
        }),
        normal: XYZ.unitZ,
        xvec: XYZ.unitX,
    });

    const res = factory.box(plane, sizeM.dx * MM_PER_M, sizeM.dy * MM_PER_M, sizeM.dz * MM_PER_M);

    if (!res.isOk) {
        throw new Error(`Failed to create building box solid: ${res.error}`);
    }

    return res.value as ISolid;
}

/**
 * Helper to construct a boom cylinder solid in metres.
 * Converts coordinates to millimetres at the Chili3D factory boundary.
 */
export function createBoomCylinder(
    factory: IShapeFactory,
    baseCenterM: XYZLike,
    radiusM: number,
    lengthM: number,
    dir: XYZ = XYZ.unitZ,
): ISolid {
    const centerMm = new XYZ({
        x: baseCenterM.x * MM_PER_M,
        y: baseCenterM.y * MM_PER_M,
        z: baseCenterM.z * MM_PER_M,
    });

    const res = factory.cylinder(dir, centerMm, radiusM * MM_PER_M, lengthM * MM_PER_M);

    if (!res.isOk) {
        throw new Error(`Failed to create boom cylinder solid: ${res.error}`);
    }

    return res.value as ISolid;
}
