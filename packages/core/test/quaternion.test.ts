// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Quaternion, XYZ } from "../src";

describe("test Quaternion", () => {
    describe("constructor", () => {
        test("default constructor creates identity quaternion", () => {
            const q = new Quaternion();
            expect(q.w).toBe(1);
            expect(q.x).toBe(0);
            expect(q.y).toBe(0);
            expect(q.z).toBe(0);
        });

        test("constructor with custom values", () => {
            const q = new Quaternion(0.5, 0.3, 0.2, 0.1);
            expect(q.w).toBe(0.5);
            expect(q.x).toBe(0.3);
            expect(q.y).toBe(0.2);
            expect(q.z).toBe(0.1);
        });
    });

    describe("fromAxisAngle", () => {
        test("creates quaternion from axis and angle", () => {
            // 90 degree rotation around Z axis
            const q = Quaternion.fromAxisAngle(XYZ.unitZ, Math.PI / 2);
            // w = cos(PI/4) ≈ 0.7071, z = sin(PI/4) ≈ 0.7071
            expect(q.w).toBeCloseTo(Math.SQRT2 / 2);
            expect(q.x).toBeCloseTo(0);
            expect(q.y).toBeCloseTo(0);
            expect(q.z).toBeCloseTo(Math.SQRT2 / 2);
        });

        test("rotation around X axis", () => {
            const q = Quaternion.fromAxisAngle(XYZ.unitX, Math.PI);
            expect(q.w).toBeCloseTo(0);
            expect(q.x).toBeCloseTo(1);
            expect(q.y).toBeCloseTo(0);
            expect(q.z).toBeCloseTo(0);
        });

        test("zero angle creates identity", () => {
            const q = Quaternion.fromAxisAngle(XYZ.unitX, 0);
            expect(q.w).toBeCloseTo(1);
            expect(q.x).toBeCloseTo(0);
            expect(q.y).toBeCloseTo(0);
            expect(q.z).toBeCloseTo(0);
        });
    });

    describe("conjugate", () => {
        test("conjugates quaternion", () => {
            const q = new Quaternion(0.5, 0.3, 0.2, 0.1);
            const c = q.conjugate();
            expect(c.w).toBe(0.5);
            expect(c.x).toBe(-0.3);
            expect(c.y).toBe(-0.2);
            expect(c.z).toBe(-0.1);
        });

        test("conjugate of identity is identity", () => {
            const q = new Quaternion();
            const c = q.conjugate();
            expect(c.w).toBeCloseTo(1);
            expect(c.x).toBeCloseTo(0);
            expect(c.y).toBeCloseTo(0);
            expect(c.z).toBeCloseTo(0);
        });
    });

    describe("invert", () => {
        test("returns conjugate", () => {
            const q = new Quaternion(0.5, 0.3, 0.2, 0.1);
            const inv = q.invert();
            expect(inv.w).toBe(q.conjugate().w);
            expect(inv.x).toBe(q.conjugate().x);
            expect(inv.y).toBe(q.conjugate().y);
            expect(inv.z).toBe(q.conjugate().z);
        });
    });

    describe("add", () => {
        test("adds two quaternions", () => {
            const q1 = new Quaternion(1, 2, 3, 4);
            const q2 = new Quaternion(5, 6, 7, 8);
            const result = q1.add(q2);
            expect(result.w).toBe(6);
            expect(result.x).toBe(8);
            expect(result.y).toBe(10);
            expect(result.z).toBe(12);
        });

        test("add with identity", () => {
            const q = new Quaternion(0.5, 0.3, 0.2, 0.1);
            const result = q.add(new Quaternion());
            expect(result.w).toBe(1.5);
            expect(result.x).toBe(0.3);
            expect(result.y).toBe(0.2);
            expect(result.z).toBe(0.1);
        });
    });

    describe("subtract", () => {
        test("subtracts two quaternions", () => {
            const q1 = new Quaternion(5, 6, 7, 8);
            const q2 = new Quaternion(1, 2, 3, 4);
            const result = q1.subtract(q2);
            expect(result.w).toBe(4);
            expect(result.x).toBe(4);
            expect(result.y).toBe(4);
            expect(result.z).toBe(4);
        });
    });

    describe("multiply", () => {
        test("multiplies two quaternions", () => {
            // 90 deg around Z * 90 deg around Z = 180 deg around Z
            const q1 = Quaternion.fromAxisAngle(XYZ.unitZ, Math.PI / 2);
            const result = q1.multiply(q1);
            // cos(PI/2)=0, sin(PI/2)*k
            expect(result.w).toBeCloseTo(0);
            expect(result.x).toBeCloseTo(0);
            expect(result.y).toBeCloseTo(0);
            expect(result.z).toBeCloseTo(1);
        });

        test("multiply with identity", () => {
            const q = new Quaternion(0.5, 0.3, 0.2, 0.1);
            const result = q.multiply(new Quaternion());
            expect(result.w).toBeCloseTo(0.5);
            expect(result.x).toBeCloseTo(0.3);
            expect(result.y).toBeCloseTo(0.2);
            expect(result.z).toBeCloseTo(0.1);
        });
    });

    describe("rotateVector", () => {
        test("rotateVector with known quaternion", () => {
            const quat = new Quaternion(0.822363, 0.0222599, 0.43968, 0.360423);
            const vector = new XYZ({ x: 0, y: 1, z: 0 });
            const gtRotVector = new XYZ({ x: -0.573223, y: 0.739199, z: 0.353553 });
            const afterRotVec = quat.rotateVector(vector);
            expect(afterRotVec.isEqualTo(gtRotVector)).toBeTruthy();
        });

        test("identity quaternion returns same vector", () => {
            const v = new XYZ({ x: 1, y: 2, z: 3 });
            const result = new Quaternion().rotateVector(v);
            expect(result.isEqualTo(v)).toBeTruthy();
        });

        test("90 degree Z rotation", () => {
            const q = Quaternion.fromAxisAngle(XYZ.unitZ, Math.PI / 2);
            const v = XYZ.unitX;
            const result = q.rotateVector(v);
            expect(result.isEqualTo(XYZ.unitY, 1e-10)).toBeTruthy();
        });
    });

    describe("toAxes", () => {
        test("identity quaternion gives identity axes", () => {
            const axes = new Quaternion().toAxes();
            expect(axes).toHaveLength(12);
            // Column-major 3x3 identity: row 0 only in col 0, row 1 only in col 1, row 2 only in col 2
            expect(axes[0]).toBeCloseTo(1); // col 0, row 0
            expect(axes[5]).toBeCloseTo(1); // col 1, row 1
            expect(axes[10]).toBeCloseTo(1); // col 2, row 2
        });

        test("Z-axis 90-degree rotation matrix", () => {
            const q = Quaternion.fromAxisAngle(XYZ.unitZ, Math.PI / 2);
            const axes = q.toAxes();
            expect(axes).toHaveLength(12);
            // Column-major 3x3 rotation: [0,1,0,  -1,0,0,  0,0,1]
            expect(axes[0]).toBeCloseTo(0); // column 0, x
            expect(axes[1]).toBeCloseTo(1); // column 0, y
            expect(axes[2]).toBeCloseTo(0); // column 0, z
            expect(axes[3]).toBeCloseTo(0); // padding

            expect(axes[4]).toBeCloseTo(-1); // column 1, x
            expect(axes[5]).toBeCloseTo(0); // column 1, y
            expect(axes[6]).toBeCloseTo(0); // column 1, z
            expect(axes[7]).toBeCloseTo(0); // padding

            expect(axes[8]).toBeCloseTo(0); // column 2, x
            expect(axes[9]).toBeCloseTo(0); // column 2, y
            expect(axes[10]).toBeCloseTo(1); // column 2, z
            expect(axes[11]).toBeCloseTo(0); // padding
        });
    });

    describe("toEuler", () => {
        test("identity quaternion yields zero euler angles", () => {
            const { x, y, z } = new Quaternion().toEuler();
            expect(x).toBeCloseTo(0);
            expect(y).toBeCloseTo(0);
            expect(z).toBeCloseTo(0);
        });

        test("pitch rotation (around X)", () => {
            const q = Quaternion.fromEuler(Math.PI / 4, 0, 0);
            const euler = q.toEuler();
            expect(euler.x).toBeCloseTo(Math.PI / 4);
            expect(euler.y).toBeCloseTo(0);
            expect(euler.z).toBeCloseTo(0);
        });

        test("yaw rotation (around Y)", () => {
            const q = Quaternion.fromEuler(0, Math.PI / 3, 0);
            const euler = q.toEuler();
            expect(euler.x).toBeCloseTo(0);
            // yaw maps to y in fromEuler, but toEuler returns x=pitch, y=yaw, z=roll
            expect(euler.y).toBeCloseTo(Math.PI / 3);
            expect(euler.z).toBeCloseTo(0);
        });

        test("roll rotation (around Z)", () => {
            const q = Quaternion.fromEuler(0, 0, Math.PI / 2);
            const euler = q.toEuler();
            expect(euler.x).toBeCloseTo(0);
            expect(euler.y).toBeCloseTo(0);
            expect(euler.z).toBeCloseTo(Math.PI / 2);
        });

        test("combined rotation", () => {
            const q = Quaternion.fromEuler(Math.PI / 6, Math.PI / 4, Math.PI / 3);
            const euler = q.toEuler();
            // Note: Euler angles are not bijective, so we verify round-trip
            const q2 = Quaternion.fromEuler(euler.x, euler.y, euler.z);
            // Test a vector after rotation by both quaternions
            const v = new XYZ({ x: 1, y: 2, z: 3 });
            const r1 = q.rotateVector(v);
            const r2 = q2.rotateVector(v);
            expect(r1.isEqualTo(r2, 1e-6)).toBeTruthy();
        });

        test("gimbal lock - test > sig * unit (pitch near 90 degrees)", () => {
            // Create quaternion that triggers the gimbal lock branch
            // FromAxisAngle around Y axis near 90 degrees
            const q = Quaternion.fromAxisAngle(XYZ.unitY, Math.PI / 2);
            const euler = q.toEuler();
            // Should produce finite values
            expect(Number.isFinite(euler.x)).toBeTruthy();
            expect(Number.isFinite(euler.y)).toBeTruthy();
            expect(Number.isFinite(euler.z)).toBeTruthy();
        });

        test("gimbal lock - test < -sig * unit (pitch near -90 degrees)", () => {
            const q = Quaternion.fromAxisAngle(XYZ.unitY, -Math.PI / 2);
            const euler = q.toEuler();
            if (euler) {
                expect(Number.isFinite(euler.x)).toBeTruthy();
                expect(Number.isFinite(euler.y)).toBeTruthy();
                expect(Number.isFinite(euler.z)).toBeTruthy();
            }
        });
    });

    describe("fromEuler", () => {
        test("all zero returns identity", () => {
            const q = Quaternion.fromEuler(0, 0, 0);
            expect(q.w).toBeCloseTo(1);
            expect(q.x).toBeCloseTo(0);
            expect(q.y).toBeCloseTo(0);
            expect(q.z).toBeCloseTo(0);
        });

        test("pitch only", () => {
            const q = Quaternion.fromEuler(Math.PI / 2, 0, 0);
            const v = XYZ.unitY;
            const rotated = q.rotateVector(v);
            // Pitch=90deg rotates Y to Z
            expect(rotated.isEqualTo(XYZ.unitZ, 1e-10)).toBeTruthy();
        });

        test("yaw only", () => {
            const q = Quaternion.fromEuler(0, Math.PI / 2, 0);
            const v = XYZ.unitX;
            const rotated = q.rotateVector(v);
            // Yaw=90deg rotates X to -Z
            expect(rotated.isEqualTo(XYZ.unitNZ, 1e-10)).toBeTruthy();
        });

        test("roll only", () => {
            const q = Quaternion.fromEuler(0, 0, Math.PI / 2);
            const v = XYZ.unitX;
            const rotated = q.rotateVector(v);
            // Roll=90deg rotates X to Y
            expect(rotated.isEqualTo(XYZ.unitY, 1e-10)).toBeTruthy();
        });

        test("all axes nonzero", () => {
            const q = Quaternion.fromEuler(Math.PI / 4, Math.PI / 6, Math.PI / 3);
            // Should produce a valid non-identity quaternion
            expect(Math.abs(q.w)).toBeGreaterThan(0);
        });
    });
});
