// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MathUtils, Matrix4, Plane, Quaternion, XYZ } from "../src";

describe("Matrix4", () => {
    test("should create matrix from array", () => {
        const transform = new Matrix4({ array: new Array(16).fill(0) });
        expect(transform.toArray().length).toBe(16);
        expect(transform.toArray()).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        // Also access array getter directly (covers @serialize get array)
        expect(transform.array.length).toBe(16);
        expect(transform.array).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    test("should transform points and vectors", () => {
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
        expect(t3.ofVector(v1).isEqualTo(new XYZ({ x: -1, y: 0, z: 0 }))).toBe(true);

        const t4 = Matrix4.fromScale(0.5, 1.5, 0);
        const p3 = new XYZ({ x: 1, y: 1, z: 0 });
        expect(t4.ofPoint(p3)).toStrictEqual(new XYZ({ x: 0.5, y: 1.5, z: 0 }));

        const t5 = t1.multiply(t3);
        expect(t5.ofPoint(XYZ.unitY).isEqualTo(new XYZ({ x: -1, y: 10, z: 0 }))).toBe(true);
        const t6 = t5.invert();
        expect(t6!.ofPoint(new XYZ({ x: -1, y: 10, z: 0 })).isEqualTo(XYZ.unitY)).toBe(true);
    });

    test("isSimilarity tells what a placement can carry", () => {
        // rigid and uniform-scale placements are similarities
        expect(Matrix4.identity().isSimilarity()).toBe(true);
        expect(Matrix4.fromTranslation(1, 2, 3).isSimilarity()).toBe(true);
        expect(Matrix4.fromEuler(0.3, 0.4, 0.5).isSimilarity()).toBe(true);
        expect(Matrix4.fromScale(2, 2, 2).isSimilarity()).toBe(true);
        // however small: a uniform scale is still a similarity (a placement can carry it)
        expect(Matrix4.fromScale(1e-7, 1e-7, 1e-7).isSimilarity()).toBe(true);
        expect(
            Matrix4.createMirrorWithPlane(
                new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY }),
            ).isSimilarity(),
        ).toBe(true);
        expect(
            Matrix4.fromEuler(0.3, 0.4, 0.5)
                .multiply(Matrix4.fromScale(2, 2, 2))
                .multiply(Matrix4.fromTranslation(1, 2, 3))
                .isSimilarity(),
        ).toBe(true);

        // a non-uniform scale, a shear, and a collapsed map are not
        expect(Matrix4.fromScale(1, 1, 2.5).isSimilarity()).toBe(false);
        expect(Matrix4.fromArray([1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).isSimilarity()).toBe(
            false,
        );
        expect(Matrix4.fromScale(1, 1, 0).isSimilarity()).toBe(false);
    });

    test("normalOf maps a normal by the inverse-transpose", () => {
        // a similarity maps normals like directions (up to scale, dropped by normalize)
        const rotation = Matrix4.fromEuler(0.3, 0.4, 0.5);
        const normal = new XYZ({ x: 0, y: 0, z: 1 });
        expect(
            rotation.normalOf(normal)!.normalize()!.isEqualTo(rotation.ofVector(normal).normalize()!),
        ).toBe(true);

        // a non-uniform scale does not: z is stretched in the geometry, so its normal is
        // squeezed by the inverse — the 45° normal stays perpendicular to the transformed plane
        const scale = Matrix4.fromScale(1, 1, 2.5);
        const mapped = scale.normalOf(new XYZ({ x: 1, y: 0, z: 1 }))!;
        expect(mapped.normalize()!.isEqualTo(new XYZ({ x: 1, y: 0, z: 0.4 }).normalize()!)).toBe(true);
        const inPlane = new XYZ({ x: 1, y: 0, z: -1 });
        expect(scale.ofVector(inPlane).dot(mapped)).toBeCloseTo(0);

        // a singular map has no normal transform
        expect(Matrix4.fromScale(1, 1, 0).normalOf(normal)).toBeUndefined();
    });

    test("should create mirror matrix with plane", () => {
        let mirror = Matrix4.createMirrorWithPlane(
            new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY }),
        );
        expect(mirror.ofPoint(new XYZ({ x: -1, y: 0, z: 0 })).isEqualTo(XYZ.unitX)).toBe(true);

        mirror = Matrix4.createMirrorWithPlane(
            new Plane({ origin: XYZ.unitX, normal: XYZ.unitX, xvec: XYZ.unitY }),
        );
        expect(mirror.ofPoint(new XYZ({ x: -1, y: 0, z: 0 })).isEqualTo(new XYZ({ x: 3, y: 0, z: 0 }))).toBe(
            true,
        );
    });

    test("should extract translation part", () => {
        const matrix = Matrix4.fromTranslation(1, 2, 3);
        expect(matrix.translationPart().isEqualTo(new XYZ({ x: 1, y: 2, z: 3 }))).toBe(true);

        const point = matrix.ofPoint(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(point.distanceTo(new XYZ({ x: 1, y: 2, z: 3 })) < 0.0001).toBe(true);
    });

    test("should extract scale", () => {
        const matrix = Matrix4.fromScale(2, 3, 4);
        expect(matrix.getScale().isEqualTo(new XYZ({ x: 2, y: 3, z: 4 }))).toBe(true);

        const point = matrix.ofPoint(new XYZ({ x: 1, y: 1, z: 1 }));
        expect(point.distanceTo(new XYZ({ x: 2, y: 3, z: 4 })) < 0.0001).toBe(true);
    });

    test("should extract euler angles", () => {
        const xRot = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitX, Math.PI / 4);
        let angles = xRot.getEulerAngles();

        expect(MathUtils.almostEqual(angles.pitch, Math.PI / 4)).toBe(true);
        expect(MathUtils.almostEqual(angles.yaw, 0)).toBe(true);
        expect(MathUtils.almostEqual(angles.roll, 0)).toBe(true);

        const yRot = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitY, Math.PI / 3);
        angles = yRot.getEulerAngles();
        expect(MathUtils.almostEqual(angles.yaw, Math.PI / 3)).toBe(true);
        expect(MathUtils.almostEqual(angles.pitch, 0)).toBe(true);
        expect(MathUtils.almostEqual(angles.roll, 0)).toBe(true);

        const zRot = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI / 2);
        angles = zRot.getEulerAngles();
        expect(MathUtils.almostEqual(angles.roll, Math.PI / 2)).toBe(true);
        expect(MathUtils.almostEqual(angles.pitch, 0)).toBe(true);
        expect(MathUtils.almostEqual(angles.yaw, 0)).toBe(true);

        const combined = Matrix4.fromEuler(Math.PI / 4, Math.PI / 3, Math.PI / 2);
        angles = combined.getEulerAngles();

        expect(MathUtils.almostEqual(angles.pitch, Math.PI / 4)).toBe(true);
        expect(MathUtils.almostEqual(angles.yaw, Math.PI / 3)).toBe(true);
        expect(MathUtils.almostEqual(angles.roll, Math.PI / 2)).toBe(true);

        const edgeCase = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitX, Math.PI);
        angles = edgeCase.getEulerAngles();
        expect(MathUtils.almostEqual(angles.pitch, Math.PI)).toBe(true);
    });

    test("should create matrix from TRS with translation only", () => {
        const matrix = Matrix4.createFromTRS(
            new XYZ({ x: 1, y: 2, z: 3 }),
            { pitch: 0, yaw: 0, roll: 0 },
            new XYZ({ x: 1, y: 1, z: 1 }),
        );

        expect(matrix.translationPart().isEqualTo(new XYZ({ x: 1, y: 2, z: 3 }))).toBe(true);
        expect(matrix.getScale().isEqualTo(new XYZ({ x: 1, y: 1, z: 1 }))).toBe(true);
    });

    test("should create matrix from TRS with rotation only", () => {
        const matrix = Matrix4.createFromTRS(
            XYZ.zero,
            { pitch: Math.PI / 2, yaw: 0, roll: 0 },
            new XYZ({ x: 1, y: 1, z: 1 }),
        );

        const angles = matrix.getEulerAngles();
        expect(MathUtils.almostEqual(angles.pitch, Math.PI / 2)).toBe(true);
        expect(MathUtils.almostEqual(angles.yaw, 0)).toBe(true);
        expect(MathUtils.almostEqual(angles.roll, 0)).toBe(true);
    });

    test("should create matrix from TRS with scale only", () => {
        const matrix = Matrix4.createFromTRS(
            XYZ.zero,
            { pitch: 0, yaw: 0, roll: 0 },
            new XYZ({ x: 2, y: 3, z: 4 }),
        );

        expect(matrix.getScale().isEqualTo(new XYZ({ x: 2, y: 3, z: 4 }))).toBe(true);
    });

    test("should create matrix from TRS with zero values", () => {
        const matrix = Matrix4.createFromTRS(
            XYZ.zero,
            { pitch: 0, yaw: 0, roll: 0 },
            new XYZ({ x: 0, y: 0, z: 0 }),
        );

        expect(matrix.translationPart().isEqualTo(XYZ.zero)).toBe(true);
        expect(matrix.getScale().isEqualTo(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(true);
    });

    test("should create matrix from non-zero euler angles", () => {
        const matrix = Matrix4.fromEuler(Math.PI / 4, Math.PI / 6, Math.PI / 3);
        const euler = matrix.getEulerAngles();
        expect(euler.pitch).toBeCloseTo(Math.PI / 4);
        expect(euler.yaw).toBeCloseTo(Math.PI / 6);
        expect(euler.roll).toBeCloseTo(Math.PI / 3);
    });

    test("should create identity matrix from zero euler angles", () => {
        const matrix = Matrix4.fromEuler(0, 0, 0);
        // Verify it acts as identity (translation is zero, ofPoint preserves input)
        const p = new XYZ({ x: 1, y: 2, z: 3 });
        expect(matrix.ofPoint(p).isEqualTo(p)).toBe(true);
        expect(matrix.determinant()).toBeCloseTo(1);
    });

    test("should add two matrices", () => {
        const a = Matrix4.fromTranslation(1, 2, 3);
        const b = Matrix4.fromTranslation(4, 5, 6);
        const result = a.add(b);
        expect(result.translationPart().x).toBeCloseTo(5);
        expect(result.translationPart().y).toBeCloseTo(7);
        expect(result.translationPart().z).toBeCloseTo(9);
    });

    test("should clone matrix", () => {
        const a = Matrix4.fromTranslation(1, 2, 3);
        const b = a.clone();
        expect(a.equals(b)).toBe(true);
        // Verify the clone has the same translation part
        expect(a.translationPart().isEqualTo(b.translationPart())).toBe(true);
    });

    test("should compare matrices for equality", () => {
        const a = Matrix4.fromTranslation(1, 2, 3);
        const b = Matrix4.fromTranslation(1, 2, 3);
        expect(a.equals(b)).toBe(true);

        const c = Matrix4.fromTranslation(1, 2, 4);
        expect(a.equals(c)).toBe(false);
    });

    test("should compute determinant of identity matrix", () => {
        expect(Matrix4.identity().determinant()).toBeCloseTo(1);
    });

    test("should compute determinant of zero matrix", () => {
        expect(Matrix4.zero().determinant()).toBe(0);
    });

    test("should compute determinant of translation matrix", () => {
        const t = Matrix4.fromTranslation(5, 10, 15);
        expect(t.determinant()).toBeCloseTo(1);
    });

    test("should compute determinant of scale matrix", () => {
        const s = Matrix4.fromScale(2, 3, 4);
        expect(s.determinant()).toBeCloseTo(24);
    });

    test("should transpose matrix", () => {
        const t = Matrix4.fromTranslation(1, 2, 3);
        const transposed = t.transpose();
        // (T^T)^T = T
        expect(transposed.transpose().equals(t)).toBe(true);
    });

    test("should keep identity matrix unchanged after transpose", () => {
        const id = Matrix4.identity();
        expect(id.transpose().equals(id)).toBe(true);
    });

    test("should transform points with identity matrix", () => {
        const points = [1, 2, 3, 4, 5, 6];
        const result = Matrix4.identity().ofPoints(points);
        expect(result).toEqual([1, 2, 3, 4, 5, 6]);
    });

    test("should transform points with translation matrix", () => {
        const t = Matrix4.fromTranslation(10, 20, 30);
        const points = [0, 0, 0];
        const result = t.ofPoints(points);
        expect(result[0]).toBeCloseTo(10);
        expect(result[1]).toBeCloseTo(20);
        expect(result[2]).toBeCloseTo(30);
    });

    test("should transform multiple points", () => {
        const t = Matrix4.fromTranslation(1, 2, 3);
        const points = [0, 0, 0, 1, 1, 1];
        const result = t.ofPoints(points);
        expect(result).toEqual([1, 2, 3, 2, 3, 4]);
    });

    test("should transform vectors with identity matrix", () => {
        const vectors = [1, 0, 0, 0, 1, 0];
        const result = Matrix4.identity().ofVectors(vectors);
        expect(result).toEqual([1, 0, 0, 0, 1, 0]);
    });

    test("should ignore translation when transforming vectors", () => {
        const t = Matrix4.fromTranslation(5, 10, 15);
        const vectors = [1, 0, 0];
        const result = t.ofVectors(vectors);
        expect(result[0]).toBeCloseTo(1);
        expect(result[1]).toBeCloseTo(0);
        expect(result[2]).toBeCloseTo(0);
    });

    test("should transform vectors by rotation", () => {
        const r = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI / 2);
        const vectors = [1, 0, 0];
        const result = r.ofVectors(vectors);
        expect(result[0]).toBeCloseTo(0);
        expect(result[1]).toBeCloseTo(1);
        expect(result[2]).toBeCloseTo(0);
    });

    test("should create zero matrix", () => {
        const z = Matrix4.zero();
        for (let i = 0; i < 16; i++) {
            expect(z.toArray()[i]).toBe(0);
        }
    });

    test("should create matrix from array values", () => {
        const data = Array.from({ length: 16 }, (_, i) => i + 1);
        const m = Matrix4.fromArray(data);
        expect(m.toArray()).toEqual(data);
    });

    test("should return undefined when inverting a singular matrix", () => {
        const z = Matrix4.zero();
        expect(z.invert()).toBeUndefined();
    });

    test("should handle gimbal lock in getEulerAngles", () => {
        // pitch = 90 degrees triggers the gimbal lock branch where |m13| >= 0.9999999
        const m = Matrix4.fromEuler(0, Math.PI / 2, 0);
        const angles = m.getEulerAngles();
        expect(angles.yaw).toBeCloseTo(Math.PI / 2);
    });

    test("should create identity matrix from identity quaternion", () => {
        const m = Matrix4.fromQuaternion(new Quaternion());
        // fromQuaternion with identity quaternion equals identity matrix
        const id = Matrix4.identity();
        expect(m.equals(id)).toBe(true);
    });

    test("should produce a valid 4x4 matrix from quaternion", () => {
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
