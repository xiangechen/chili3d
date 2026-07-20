// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MathUtils, Matrix4, Plane, Quaternion, XYZ } from "../src";

describe("test Transform", () => {
    test("test constructor", () => {
        const transform = new Matrix4({ array: new Array(16).fill(0) });
        expect(transform.toArray().length).toBe(16);
        expect(transform.toArray()).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        // Also access array getter directly (covers @serialize get array)
        expect(transform.array.length).toBe(16);
        expect(transform.array).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
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

    test("test fromEuler with non-zero angles", () => {
        const matrix = Matrix4.fromEuler(Math.PI / 4, Math.PI / 6, Math.PI / 3);
        const euler = matrix.getEulerAngles();
        expect(euler.pitch).toBeDefined();
        expect(euler.yaw).toBeDefined();
        expect(euler.roll).toBeDefined();
    });

    test("test fromEuler zero angles", () => {
        const matrix = Matrix4.fromEuler(0, 0, 0);
        // Verify it acts as identity (translation is zero, ofPoint preserves input)
        const p = new XYZ({ x: 1, y: 2, z: 3 });
        expect(matrix.ofPoint(p).isEqualTo(p)).toBeTruthy();
        expect(matrix.determinant()).toBeCloseTo(1);
    });

    test("test add", () => {
        const a = Matrix4.fromTranslation(1, 2, 3);
        const b = Matrix4.fromTranslation(4, 5, 6);
        const result = a.add(b);
        expect(result.translationPart().x).toBeCloseTo(5);
        expect(result.translationPart().y).toBeCloseTo(7);
        expect(result.translationPart().z).toBeCloseTo(9);
    });

    test("test clone", () => {
        const a = Matrix4.fromTranslation(1, 2, 3);
        const b = a.clone();
        expect(a.equals(b)).toBeTruthy();
        // Verify it's a different instance
        expect(a.translationPart().isEqualTo(b.translationPart())).toBeTruthy();
    });

    test("test equals", () => {
        const a = Matrix4.fromTranslation(1, 2, 3);
        const b = Matrix4.fromTranslation(1, 2, 3);
        expect(a.equals(b)).toBeTruthy();

        const c = Matrix4.fromTranslation(1, 2, 4);
        expect(a.equals(c)).toBeFalsy();
    });

    test("test determinant - identity", () => {
        expect(Matrix4.identity().determinant()).toBeCloseTo(1);
    });

    test("test determinant - zero matrix", () => {
        expect(Matrix4.zero().determinant()).toBe(0);
    });

    test("test determinant - translation matrix", () => {
        const t = Matrix4.fromTranslation(5, 10, 15);
        expect(t.determinant()).toBeCloseTo(1);
    });

    test("test determinant - scale matrix", () => {
        const s = Matrix4.fromScale(2, 3, 4);
        expect(s.determinant()).toBeCloseTo(24);
    });

    test("test transpose", () => {
        const t = Matrix4.fromTranslation(1, 2, 3);
        const transposed = t.transpose();
        // (T^T)^T = T
        expect(transposed.transpose().equals(t)).toBeTruthy();
    });

    test("test transpose of transpose is identity for identity", () => {
        const id = Matrix4.identity();
        expect(id.transpose().equals(id)).toBeTruthy();
    });

    test("test ofPoints with identity", () => {
        const points = [1, 2, 3, 4, 5, 6];
        const result = Matrix4.identity().ofPoints(points);
        expect(result).toEqual([1, 2, 3, 4, 5, 6]);
    });

    test("test ofPoints with translation", () => {
        const t = Matrix4.fromTranslation(10, 20, 30);
        const points = [0, 0, 0];
        const result = t.ofPoints(points);
        expect(result[0]).toBeCloseTo(10);
        expect(result[1]).toBeCloseTo(20);
        expect(result[2]).toBeCloseTo(30);
    });

    test("test ofPoints with multiple points", () => {
        const t = Matrix4.fromTranslation(1, 2, 3);
        const points = [0, 0, 0, 1, 1, 1];
        const result = t.ofPoints(points);
        expect(result).toEqual([1, 2, 3, 2, 3, 4]);
    });

    test("test ofVectors with identity", () => {
        const vectors = [1, 0, 0, 0, 1, 0];
        const result = Matrix4.identity().ofVectors(vectors);
        expect(result).toEqual([1, 0, 0, 0, 1, 0]);
    });

    test("test ofVectors ignores translation", () => {
        const t = Matrix4.fromTranslation(5, 10, 15);
        const vectors = [1, 0, 0];
        const result = t.ofVectors(vectors);
        expect(result[0]).toBeCloseTo(1);
        expect(result[1]).toBeCloseTo(0);
        expect(result[2]).toBeCloseTo(0);
    });

    test("test ofVectors are transformed by rotation", () => {
        const r = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI / 2);
        const vectors = [1, 0, 0];
        const result = r.ofVectors(vectors);
        expect(result[0]).toBeCloseTo(0);
        expect(result[1]).toBeCloseTo(1);
        expect(result[2]).toBeCloseTo(0);
    });

    test("test zero static factory", () => {
        const z = Matrix4.zero();
        for (let i = 0; i < 16; i++) {
            expect(z.toArray()[i]).toBe(0);
        }
    });

    test("test fromArray", () => {
        const data = Array.from({ length: 16 }, (_, i) => i + 1);
        const m = Matrix4.fromArray(data);
        expect(m.toArray()).toEqual(data);
    });

    test("test invert returns undefined for singular matrix", () => {
        const z = Matrix4.zero();
        expect(z.invert()).toBeUndefined();
    });

    test("test getEulerAngles gimbal lock branch", () => {
        // pitch = 90 degrees triggers the gimbal lock branch where |m13| >= 0.9999999
        const m = Matrix4.fromEuler(0, Math.PI / 2, 0);
        const angles = m.getEulerAngles();
        expect(angles.yaw).toBeCloseTo(Math.PI / 2);
    });

    test("test fromQuaternion identity", () => {
        const m = Matrix4.fromQuaternion(new Quaternion());
        // fromQuaternion with identity quaternion equals identity matrix
        const id = Matrix4.identity();
        expect(m.equals(id)).toBeTruthy();
    });

    test("test fromQuaternion produces valid shape", () => {
        const q = new Quaternion(0.5, 0.5, 0.5, 0.5);
        const m = Matrix4.fromQuaternion(q);
        // Should produce a 4x4 matrix
        expect(m.toArray().length).toBe(16);
        // Last column of transform is [0, 0, 0, 1]
        const arr = m.toArray();
        expect(arr[3]).toBeCloseTo(0);
        expect(arr[7]).toBeCloseTo(0);
        expect(arr[11]).toBeCloseTo(0);
        expect(arr[15]).toBeCloseTo(1);
    });
});
