// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4 } from "./matrix4";

export class Quaternion {
    readonly w: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    constructor(w = 1, x = 0, y = 0, z = 0) {
        this.w = w;
        this.x = x;
        this.y = y;
        this.z = z;
    }
    add(q: Quaternion): Quaternion {
        return new Quaternion(this.w + q.w, this.x + q.x, this.y + q.y, this.z + q.z);
    }
    subtract(q: Quaternion): Quaternion {
        return new Quaternion(this.w - q.w, this.x - q.x, this.y - q.y, this.z - q.z);
    }
    multiply(q: Quaternion): Quaternion {
        const { w: w1, x: x1, y: y1, z: z1 } = this;
        const { w: w2, x: x2, y: y2, z: z2 } = q;

        return new Quaternion(
            w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
            w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
        );
    }
    conjugate(): Quaternion {
        return new Quaternion(this.w, -this.x, -this.y, -this.z);
    }
    magnitude(): number {
        return Math.sqrt(this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z);
    }
    normalize(): Quaternion {
        const magnitude = this.magnitude();
        if (magnitude === 0) {
            return new Quaternion();
        }
        const invMagnitude = 1 / magnitude;
        return new Quaternion(
            this.w * invMagnitude,
            this.x * invMagnitude,
            this.y * invMagnitude,
            this.z * invMagnitude,
        );
    }
    toEuler(): { x: number; y: number; z: number } {
        const sinr_cosp = 2 * (this.w * this.x + this.y * this.z);
        const cosr_cosp = 1 - 2 * (this.x * this.x + this.y * this.y);
        const roll = Math.atan2(sinr_cosp, cosr_cosp);
        const sinp = 2 * (this.w * this.y - this.z * this.x);
        const pitch = Math.abs(sinp) >= 1 ? (Math.PI / 2) * Math.sign(sinp) : Math.asin(sinp);
        const siny_cosp = 2 * (this.w * this.z + this.x * this.y);
        const cosy_cosp = 1 - 2 * (this.y * this.y + this.z * this.z);
        const yaw = Math.atan2(siny_cosp, cosy_cosp);
        return {
            x: roll,
            y: pitch,
            z: yaw,
        };
    }
    toMatrix4(): Matrix4 {
        const xx = this.x * this.x;
        const yy = this.y * this.y;
        const zz = this.z * this.z;
        const xy = this.x * this.y;
        const xz = this.x * this.z;
        const yz = this.y * this.z;
        const xw = this.x * this.w;
        const yw = this.y * this.w;
        const zw = this.z * this.w;

        return Matrix4.fromArray([
            1 - 2 * (yy + zz),
            2 * (xy - zw),
            2 * (xz + yw),
            0,
            2 * (xy + zw),
            1 - 2 * (xx + zz),
            2 * (yz - xw),
            0,
            2 * (xz - yw),
            2 * (yz + xw),
            1 - 2 * (xx + yy),
            0,
            0,
            0,
            0,
            1,
        ]);
    }
    static fromEuler(roll: number, pitch: number, yaw: number): Quaternion {
        const halfRoll = roll * 0.5;
        const halfPitch = pitch * 0.5;
        const halfYaw = yaw * 0.5;

        const cr = Math.cos(halfRoll);
        const sr = Math.sin(halfRoll);
        const cp = Math.cos(halfPitch);
        const sp = Math.sin(halfPitch);
        const cy = Math.cos(halfYaw);
        const sy = Math.sin(halfYaw);

        return new Quaternion(
            cr * cp * cy + sr * sp * sy,
            sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy,
        );
    }
}
