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
    toEuler(): { x: number; y: number; z: number } {
        let sig = 0.499;
        let [qw, qx, qy, qz] = [this.w, this.x, this.y, this.z];
        let [sqw, sqx, sqy, sqz] = [qw * qw, qx * qx, qy * qy, qz * qz];
        let unit = sqx + sqz + sqy + sqw;
        let test = qx * qz + qy * qw;
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
    toMatrix4(): Matrix4 {
        const x2 = this.x * this.x;
        const y2 = this.y * this.y;
        const z2 = this.z * this.z;

        const xx2 = x2 * this.x;
        const xy2 = x2 * this.y;
        const xz2 = x2 * this.z;

        const yy2 = y2 * this.y;
        const yz2 = y2 * this.z;
        const zz2 = z2 * this.z;

        const sy2 = y2 * this.w;
        const sz2 = z2 * this.w;
        const sx2 = x2 * this.w;

        return Matrix4.fromArray([
            1 - yy2 - zz2,
            xy2 + sz2,
            xz2 - sy2,
            0,
            xy2 - sz2,
            1 - xx2 - zz2,
            yz2 + sx2,
            0,
            xz2 + sy2,
            yz2 - sx2,
            1 - xx2 - yy2,
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
            -sr * sp * sy + cr * cp * cy,
            sr * cp * cy + cr * sp * sy,
            -sr * cp * sy + cr * sp * cy,
            cr * cp * sy + sr * sp * cy,
        );
    }
}
