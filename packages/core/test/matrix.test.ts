// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MathUtils, Matrix4, Plane, XYZ } from "../src";

describe("test Transform", () => {
    test("test constructor", () => {
        const transform = new Matrix4({ array: new Array(16).fill(0) });
        expect(transform.toArray().length).toBe(16);
        expect(transform.toArray()).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    test("test operation", () => {
        const t1 = Matrix4.fromTranslation(10, 0, 0);
        const p1 = XYZ.zero;
        const v1 = XYZ.unitY;
        const p2 = t1.ofPoint(p1);
        const v2 = t1.ofVector(v1);
        expect(p2).toStrictEqual(new XYZ({ x: 10, y: 0, z: 0 }));
        expect(v2).toStrictEqual(v1);
        const t2 = t1.invert();
        expect(t2!.ofPoint(p2)).toStrictEqual(p1);

        const t3 = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI * 0.5);
        expect(t3.ofVector(v1).isEqualTo(new XYZ({ x: -1, y: 0, z: 0 }))).toBeTruthy();

        const t4 = Matrix4.fromScale(0.5, 1.5, 0);
        const p3 = new XYZ({ x: 1, y: 1, z: 0 });
        expect(t4.ofPoint(p3)).toStrictEqual(new XYZ({ x: 0.5, y: 1.5, z: 0 }));

        const t5 = t1.multiply(t3);
        expect(t5.ofPoint(XYZ.unitY).isEqualTo(new XYZ({ x: -1, y: 10, z: 0 }))).toBeTruthy();
        const t6 = t5.invert();
        expect(t6!.ofPoint(new XYZ({ x: -1, y: 10, z: 0 })).isEqualTo(XYZ.unitY)).toBeTruthy();
    });

    test("test mirror", () => {
        let mirror = Matrix4.createMirrorWithPlane(
            new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY }),
        );
        expect(mirror.ofPoint(new XYZ({ x: -1, y: 0, z: 0 })).isEqualTo(XYZ.unitX)).toBeTruthy();

        mirror = Matrix4.createMirrorWithPlane(
            new Plane({ origin: XYZ.unitX, normal: XYZ.unitX, xvec: XYZ.unitY }),
        );
        expect(
            mirror.ofPoint(new XYZ({ x: -1, y: 0, z: 0 })).isEqualTo(new XYZ({ x: 3, y: 0, z: 0 })),
        ).toBeTruthy();
    });

    test("test translationPart", () => {
        const matrix = Matrix4.fromTranslation(1, 2, 3);
        expect(matrix.translationPart().isEqualTo(new XYZ({ x: 1, y: 2, z: 3 }))).toBeTruthy();

        const point = matrix.ofPoint(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(point.distanceTo(new XYZ({ x: 1, y: 2, z: 3 })) < 0.0001).toBeTruthy();
    });

    test("test getScale", () => {
        const matrix = Matrix4.fromScale(2, 3, 4);
        expect(matrix.getScale().isEqualTo(new XYZ({ x: 2, y: 3, z: 4 }))).toBeTruthy();

        const point = matrix.ofPoint(new XYZ({ x: 1, y: 1, z: 1 }));
        expect(point.distanceTo(new XYZ({ x: 2, y: 3, z: 4 })) < 0.0001).toBeTruthy();
    });

    test("test getEulerAngles", () => {
        const xRot = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitX, Math.PI / 4);
        let angles = xRot.getEulerAngles();

        expect(MathUtils.almostEqual(angles.pitch, Math.PI / 4)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.yaw, 0)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.roll, 0)).toBeTruthy();

        const yRot = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitY, Math.PI / 3);
        angles = yRot.getEulerAngles();
        expect(MathUtils.almostEqual(angles.yaw, Math.PI / 3)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.pitch, 0)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.roll, 0)).toBeTruthy();

        const zRot = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI / 2);
        angles = zRot.getEulerAngles();
        expect(MathUtils.almostEqual(angles.roll, Math.PI / 2)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.pitch, 0)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.yaw, 0)).toBeTruthy();

        const combined = Matrix4.fromEuler(Math.PI / 4, Math.PI / 3, Math.PI / 2);
        angles = combined.getEulerAngles();

        expect(MathUtils.almostEqual(angles.pitch, Math.PI / 4)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.yaw, Math.PI / 3)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.roll, Math.PI / 2)).toBeTruthy();

        const edgeCase = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitX, Math.PI);
        angles = edgeCase.getEulerAngles();
        expect(MathUtils.almostEqual(angles.pitch, Math.PI)).toBeTruthy();
    });

    test("test createFromTRS - translation only", () => {
        const matrix = Matrix4.createFromTRS(
            new XYZ({ x: 1, y: 2, z: 3 }),
            { pitch: 0, yaw: 0, roll: 0 },
            new XYZ({ x: 1, y: 1, z: 1 }),
        );

        expect(matrix.translationPart().isEqualTo(new XYZ({ x: 1, y: 2, z: 3 }))).toBeTruthy();
        expect(matrix.getScale().isEqualTo(new XYZ({ x: 1, y: 1, z: 1 }))).toBeTruthy();
    });

    test("test createFromTRS - rotation only", () => {
        const matrix = Matrix4.createFromTRS(
            XYZ.zero,
            { pitch: Math.PI / 2, yaw: 0, roll: 0 },
            new XYZ({ x: 1, y: 1, z: 1 }),
        );

        const angles = matrix.getEulerAngles();
        expect(MathUtils.almostEqual(angles.pitch, Math.PI / 2)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.yaw, 0)).toBeTruthy();
        expect(MathUtils.almostEqual(angles.roll, 0)).toBeTruthy();
    });

    test("test createFromTRS - scale only", () => {
        const matrix = Matrix4.createFromTRS(
            XYZ.zero,
            { pitch: 0, yaw: 0, roll: 0 },
            new XYZ({ x: 2, y: 3, z: 4 }),
        );

        expect(matrix.getScale().isEqualTo(new XYZ({ x: 2, y: 3, z: 4 }))).toBeTruthy();
    });

    test("test createFromTRS - zero values", () => {
        const matrix = Matrix4.createFromTRS(
            XYZ.zero,
            { pitch: 0, yaw: 0, roll: 0 },
            new XYZ({ x: 0, y: 0, z: 0 }),
        );

        expect(matrix.translationPart().isEqualTo(XYZ.zero)).toBeTruthy();
        expect(matrix.getScale().isEqualTo(new XYZ({ x: 0, y: 0, z: 0 }))).toBeTruthy();
    });
});
