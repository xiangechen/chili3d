// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryUtils, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { createTestFactory, unwrapOk } from "./helpers";
import "./setup";

/**
 * Placing text on a picked face reads two things off that face: whether it is
 * flat enough to hold a plane at all, and which plane it is. Both are asked of
 * the kernel here rather than of a stand-in, since the text ends up wherever
 * these answer.
 */
describe("face planes", () => {
    test("a box's faces are flat, and each reports its own plane", () => {
        const factory = createTestFactory();
        const box = unwrapOk(factory.box(Plane.XY, 10, 20, 30));
        const faces = box.findSubShapes(ShapeTypes.face) as IFace[];

        expect(faces.length).toBe(6);
        for (const face of faces) {
            expect(face.surface().isPlanar()).toBe(true);

            const plane = GeometryUtils.planeFromFace(face);
            const [point, normal] = face.normal(0, 0);
            // The plane must sit where the face is and face the same way, so text
            // laid on it lies on the face and extrudes off it.
            expect(plane.normal.isParallelTo(normal, 1e-6)).toBe(true);
            expect(plane.origin).toEqual(point);
            // Both of the plane's own axes must stay in it.
            expect(plane.xvec.dot(plane.normal)).toBeCloseTo(0, 6);
            expect(plane.yvec.dot(plane.normal)).toBeCloseTo(0, 6);
        }
    });

    test("a cylinder's side is not flat", () => {
        const factory = createTestFactory();
        const cylinder = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 20));
        const sides = (cylinder.findSubShapes(ShapeTypes.face) as IFace[]).filter(
            (face) => !face.surface().isPlanar(),
        );

        expect(sides.length).toBe(1);
    });

    test("a circle's face is flat", () => {
        const factory = createTestFactory();
        const circle = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 5));
        const face = unwrapOk(factory.face([unwrapOk(factory.wire([circle]))]));

        expect(face.surface().isPlanar()).toBe(true);
    });
});
