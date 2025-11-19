// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ, type XYZLike } from "./xyz";

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

    static fromAxisAngle(axis: XYZLike, rad: number): Quaternion {
        const sin = Math.sin(rad * 0.5);
        const cos = Math.cos(rad * 0.5);
        return new Quaternion(cos, axis.x * sin, axis.y * sin, axis.z * sin);
    }

    conjugate(): Quaternion {
        return new Quaternion(this.w, -this.x, -this.y, -this.z);
    }

    invert(): Quaternion {
        return this.conjugate();
    }

    rotateVector(vec3: XYZLike): XYZ {
        const q = new Quaternion(0, vec3.x, vec3.y, vec3.z);
        const r = this.multiply(q).multiply(this.conjugate());
        return new XYZ(r.x, r.y, r.z);
    }

    toAxes() {
        const { x, y, z, w } = this;
        const x2 = x + x;
        const y2 = y + y;
        const z2 = z + z;
        const xx = x * x2;
        const xy = x * y2;
        const xz = x * z2;
        const yy = y * y2;
        const yz = y * z2;
        const zz = z * z2;
        const wx = w * x2;
        const wy = w * y2;
        const wz = w * z2;
        return [
            1.0 - (yy + zz),
            xy + wz,
            xz - wy,
            0.0,
            xy - wz,
            1.0 - (xx + zz),
            yz + wx,
            0.0,
            xz + wy,
            yz - wx,
            1.0 - (xx + yy),
            0.0,
        ];
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
    toEuler(): { x: number; y: number; z: number } {
        const sig = 0.499;
        const [qw, qx, qy, qz] = [this.w, this.x, this.y, this.z];
        const [sqw, sqx, sqy, sqz] = [qw * qw, qx * qx, qy * qy, qz * qz];
        const unit = sqx + sqz + sqy + sqw;
        const test = qx * qz + qy * qw;
        if (test > sig * unit) {
            return {
                x: 0,
                y: Math.PI / 4,
                z: Math.atan2(qx, qw) * 2,
            };
        } else if (test < -sig * unit) {
            return {
                x: 0,
                y: -Math.PI / 4,
                z: Math.atan2(qx, qw) * 2,
            };
        } else {
            return {
                x: Math.atan2(2 * (-qy * qz + qx * qw), 1 - 2 * (sqx + sqy)),
                y: Math.asin(2 * (qx * qz + qy * qw)),
                z: Math.atan2(2 * (-qx * qy + qz * qw), 1 - 2 * (sqy + sqz)),
            };
        }
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
            -sr * sp * sy + cr * cp * cy,
            sr * cp * cy + cr * sp * sy,
            -sr * cp * sy + cr * sp * cy,
            cr * cp * sy + sr * sp * cy,
        );
    }
}
