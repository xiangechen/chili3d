// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, XYZ } from "@chili3d/core";
import {
    curvePointPlane,
    lineAnglePlane,
    midPlaneOf,
    threePointPlane,
} from "../../src/plane/planeDefinition";

describe("lineAnglePlane", () => {
    const reference = Plane.XY;
    const origin = new XYZ(0, 0, 0);
    const xAxis = new XYZ(1, 0, 0);

    test("angle zero is parallel to the reference plane", () => {
        const plane = lineAnglePlane(origin, xAxis, reference, 0, undefined, false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.normal.z).toBeCloseTo(1, 6);
        expect(plane.value.xvec.x).toBeCloseTo(1, 6);
    });

    test("the frame is canonical, not along the line", () => {
        // A line along +Y with a +Z normal: the canonical frame still takes X along world X.
        const plane = lineAnglePlane(origin, new XYZ(0, 1, 0), reference, 0, undefined, false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.normal.z).toBeCloseTo(1, 6);
        expect(plane.value.xvec.x).toBeCloseTo(1, 6);
        expect(plane.value.xvec.y).toBeCloseTo(0, 6);
    });

    test("ninety degrees tilts the plane onto the line", () => {
        const plane = lineAnglePlane(origin, xAxis, reference, 90, undefined, false);
        expect(plane.isOk).toBe(true);
        // +Z rotated 90° about +X is -Y.
        expect(plane.value.normal.y).toBeCloseTo(-1, 6);
        expect(plane.value.normal.z).toBeCloseTo(0, 6);
    });

    test("forty five degrees is the angle bisector", () => {
        const plane = lineAnglePlane(origin, xAxis, reference, 45, undefined, false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.normal.y).toBeCloseTo(-Math.SQRT1_2, 6);
        expect(plane.value.normal.z).toBeCloseTo(Math.SQRT1_2, 6);
    });

    test("the captured direction keeps the rotation sense after a rebuild flip", () => {
        const same = lineAnglePlane(origin, xAxis, reference, 45, { x: 1, y: 0, z: 0 }, false);
        const flipped = lineAnglePlane(origin, xAxis.reverse(), reference, 45, { x: 1, y: 0, z: 0 }, false);
        expect(same.isOk && flipped.isOk).toBe(true);
        expect(flipped.value.normal.y).toBeCloseTo(same.value.normal.y, 6);
        expect(flipped.value.normal.z).toBeCloseTo(same.value.normal.z, 6);
    });

    test("flip reverses the normal", () => {
        const plane = lineAnglePlane(origin, xAxis, reference, 30, undefined, true);
        expect(plane.isOk).toBe(true);
        expect(plane.value.normal.z).toBeLessThan(0);
    });

    test("a line parallel to the reference normal has no angle plane", () => {
        const plane = lineAnglePlane(origin, new XYZ(0, 0, 1), reference, 45, undefined, false);
        expect(plane.isOk).toBe(false);
        expect(plane.error).toContain("parallel");
    });

    test("a degenerate line direction is rejected", () => {
        const plane = lineAnglePlane(origin, new XYZ(0, 0, 0), reference, 45, undefined, false);
        expect(plane.isOk).toBe(false);
    });
});

describe("threePointPlane", () => {
    test("three points define a plane in the canonical frame", () => {
        const plane = threePointPlane(new XYZ(0, 0, 0), new XYZ(2, 0, 0), new XYZ(0, 3, 0), false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.origin.x).toBeCloseTo(0, 6);
        expect(plane.value.normal.z).toBeCloseTo(1, 6);
        expect(plane.value.xvec.x).toBeCloseTo(1, 6);
    });

    test("the frame depends on the plane alone, not on which point is picked second", () => {
        // First edge along +Y, third point along +X: the normal is -Z. The canonical
        // frame for -Z is X = world -X, so the first edge does NOT set the x axis.
        const plane = threePointPlane(new XYZ(0, 0, 0), new XYZ(0, 2, 0), new XYZ(3, 0, 0), false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.normal.z).toBeCloseTo(-1, 6);
        expect(plane.value.xvec.x).toBeCloseTo(-1, 6);
        expect(plane.value.xvec.y).toBeCloseTo(0, 6);
    });

    test("flip reverses the normal", () => {
        const plane = threePointPlane(new XYZ(0, 0, 0), new XYZ(2, 0, 0), new XYZ(0, 3, 0), true);
        expect(plane.value.normal.z).toBeCloseTo(-1, 6);
    });

    test("collinear points are rejected", () => {
        const plane = threePointPlane(new XYZ(0, 0, 0), new XYZ(1, 0, 0), new XYZ(2, 0, 0), false);
        expect(plane.isOk).toBe(false);
        expect(plane.error).toContain("collinear");
    });
});

describe("midPlaneOf", () => {
    test("two parallel planes give the plane halfway between them", () => {
        const lower = Plane.XY;
        const upper = new Plane({ origin: new XYZ(0, 0, 8), normal: XYZ.unitZ, xvec: XYZ.unitX });
        const plane = midPlaneOf(lower, upper, false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.origin.z).toBeCloseTo(4, 6);
        expect(plane.value.normal.z).toBeCloseTo(1, 6);
    });

    test("antiparallel normals still give the midpoint", () => {
        const lower = Plane.XY;
        const upper = new Plane({ origin: new XYZ(0, 0, 8), normal: XYZ.unitZ.reverse(), xvec: XYZ.unitX });
        const plane = midPlaneOf(lower, upper, false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.origin.z).toBeCloseTo(4, 6);
    });

    test("coincident planes are rejected", () => {
        const plane = midPlaneOf(Plane.XY, Plane.XY, false);
        expect(plane.isOk).toBe(false);
        expect(plane.error).toContain("coincident");
    });

    test("intersecting planes give their bisector", () => {
        const plane = midPlaneOf(Plane.XY, Plane.YZ, false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.normal.x).toBeCloseTo(Math.SQRT1_2, 6);
        expect(plane.value.normal.z).toBeCloseTo(Math.SQRT1_2, 6);
        // The intersection line of XY and YZ runs along +Y.
        // The frame comes from the plane alone, so the intersection line is ±Y.
        expect(Math.abs(plane.value.xvec.y)).toBeCloseTo(1, 6);
    });

    test("flip selects the other bisector, keeping the intersection line", () => {
        const plane = midPlaneOf(Plane.XY, Plane.YZ, true);
        expect(plane.isOk).toBe(true);
        // The other bisector: n1 - n2 = (-1, 0, 1)/sqrt(2), not the same plane reversed.
        expect(plane.value.normal.x).toBeCloseTo(-Math.SQRT1_2, 6);
        expect(plane.value.normal.z).toBeCloseTo(Math.SQRT1_2, 6);
        // The frame comes from the plane alone, so the intersection line is ±Y.
        expect(Math.abs(plane.value.xvec.y)).toBeCloseTo(1, 6);
        // It is perpendicular to the unflipped bisector, proving a different plane.
        expect(plane.value.normal.dot(new XYZ(Math.SQRT1_2, 0, Math.SQRT1_2))).toBeCloseTo(0, 6);
    });
});

describe("curvePointPlane", () => {
    const point = new XYZ(2, 3, 4);

    test("the plane passes through the point with the curve tangent as normal", () => {
        const plane = curvePointPlane(point, XYZ.unitZ, undefined, false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.origin.isEqualTo(point)).toBe(true);
        expect(plane.value.normal.z).toBeCloseTo(1, 6);
    });

    test("the captured tangent keeps the normal's sign after a direction flip", () => {
        const plane = curvePointPlane(point, XYZ.unitZ.reverse(), { x: 0, y: 0, z: 1 }, false);
        expect(plane.isOk).toBe(true);
        expect(plane.value.normal.z).toBeCloseTo(1, 6);
    });

    test("a degenerate tangent is rejected", () => {
        const plane = curvePointPlane(point, XYZ.zero, undefined, false);
        expect(plane.isOk).toBe(false);
    });
});
