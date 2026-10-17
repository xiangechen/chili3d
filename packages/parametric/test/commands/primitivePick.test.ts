// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, XYZ } from "@chili3d/core";
import { normalizeSignedRect, rectDataOnPlane, signedHeightAxis } from "../../src/commands/primitivePick";

const at = (x: number, y: number, z: number) => new XYZ(x, y, z);

describe("rectDataOnPlane", () => {
    test("the plane moves to the first corner and the spans come out signed", () => {
        const { plane, dx, dy } = rectDataOnPlane(Plane.XY, at(1, 2, 3), at(4, -1, 9));

        expect([plane.origin.x, plane.origin.y, plane.origin.z]).toEqual([1, 2, 3]);
        expect([plane.normal.x, plane.normal.y, plane.normal.z]).toEqual([0, 0, 1]);
        // The z difference is off the plane and counts for nothing.
        expect(dx).toBe(3);
        expect(dy).toBe(-3);
    });

    test("a rotated pick plane measures in its own frame", () => {
        const pick = new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY });
        const { dx, dy } = rectDataOnPlane(pick, at(0, 0, 0), at(5, 2, -7));

        expect(dx).toBe(2);
        expect(dy).toBe(-7);
    });
});

describe("normalizeSignedRect", () => {
    test("a positive drag keeps the origin", () => {
        const { origin, dx, dy } = normalizeSignedRect(at(1, 1, 0), XYZ.unitX, XYZ.unitY, 3, 4);

        expect([origin.x, origin.y, origin.z]).toEqual([1, 1, 0]);
        expect([dx, dy]).toEqual([3, 4]);
    });

    test("a negative span folds into the origin, keeping the world rectangle", () => {
        const { origin, dx, dy } = normalizeSignedRect(at(10, 20, 0), XYZ.unitX, XYZ.unitY, -6, 8);

        // Dragged from x=10 leftwards by 6: the canonical corner lands at x=4.
        expect([origin.x, origin.y, origin.z]).toEqual([4, 20, 0]);
        expect([dx, dy]).toEqual([6, 8]);
    });

    test("both spans negative shifts both axes; a tilted frame shifts along its own axes", () => {
        const both = normalizeSignedRect(at(5, 5, 5), XYZ.unitX, XYZ.unitY, -2, -3);
        expect([both.origin.x, both.origin.y, both.origin.z]).toEqual([3, 2, 5]);
        expect([both.dx, both.dy]).toEqual([2, 3]);

        const tilted = normalizeSignedRect(at(0, 0, 0), XYZ.unitY, XYZ.unitZ, -4, 1);
        expect([tilted.origin.x, tilted.origin.y, tilted.origin.z]).toEqual([0, -4, 0]);
        expect([tilted.dx, tilted.dy]).toEqual([4, 1]);
    });
});

describe("signedHeightAxis", () => {
    test("a positive climb keeps the normal", () => {
        const { axis, height } = signedHeightAxis(XYZ.unitZ, 12);

        expect([axis.x, axis.y, axis.z]).toEqual([0, 0, 1]);
        expect(height).toBe(12);
    });

    test("a negative climb flips the axis and stores the height positive", () => {
        const { axis, height } = signedHeightAxis(XYZ.unitZ, -7);

        expect([axis.x, axis.y, axis.z]).toEqual([0, 0, -1]);
        expect(height).toBe(7);
    });
});
