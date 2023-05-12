// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Matrix4 } from "./matrix4";
import { XYZ } from "./xyz";

export class Quaternion {
    constructor(readonly x: number, readonly y: number, readonly z: number, readonly w: number) {}

    static fromEuler(x: number, y: number, z: number): Quaternion {
        const c1 = Math.cos(x / 2);
        const c2 = Math.cos(y / 2);
        const c3 = Math.cos(z / 2);
        const s1 = Math.sin(x / 2);
        const s2 = Math.sin(y / 2);
        const s3 = Math.sin(z / 2);
        return new Quaternion(
            s1 * c2 * c3 + c1 * s2 * s3,
            c1 * s2 * c3 - s1 * c2 * s3,
            c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3
        );
    }

    static fromAxisAngle({ x, y, z }: XYZ, angle: number): Quaternion {
        const halfAngle = angle / 2;
        const s = Math.sin(halfAngle);
        return new Quaternion(x * s, y * s, z * s, Math.cos(halfAngle));
    }

    static multiply(q1: Quaternion, q2: Quaternion): Quaternion {
        return new Quaternion(
            q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
            q1.w * q2.y + q1.y * q2.w + q1.z * q2.x - q1.x * q2.z,
            q1.w * q2.z + q1.z * q2.w + q1.x * q2.y - q1.y * q2.x,
            q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
        );
    }

    static dot(q1: Quaternion, q2: Quaternion): number {
        return q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
    }

    static conjugate(q: Quaternion): Quaternion {
        return new Quaternion(-q.x, -q.y, -q.z, q.w);
    }

    static inverse(q: Quaternion): Quaternion {
        return Quaternion.conjugate(q).normalize();
    }

    normalize(): Quaternion {
        const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
        return new Quaternion(this.x / l, this.y / l, this.z / l, this.w / l);
    }

    toMatrix(): Matrix4 {
        const x = this.x;
        const y = this.y;
        const z = this.z;
        const w = this.w;
        return new Matrix4(
            1 - 2 * y * y - 2 * z * z,
            2 * x * y - 2 * z * w,
            2 * x * z + 2 * y * w,
            0,
            2 * x * y + 2 * z * w,
            1 - 2 * x * x - 2 * z * z,
            2 * y * z - 2 * x * w,
            0,
            2 * x * z - 2 * y * w,
            2 * y * z + 2 * x * w,
            1 - 2 * x * x - 2 * y * y,
            0,
            0,
            0,
            0,
            1
        );
    }

    toEuler(): XYZ {
        const sqw = this.w * this.w;
        const sqx = this.x * this.x;
        const sqy = this.y * this.y;
        const sqz = this.z * this.z;
        const unit = sqx + sqy + sqz + sqw;
        const test = this.x * this.y + this.z * this.w;
        const heading = Math.atan2(2 * this.y * this.w - 2 * this.x * this.z, sqx - sqy - sqz + sqw);
        const attitude =
            test > 0.499 * unit
                ? Math.PI / 2
                : test < -0.499 * unit
                ? -Math.PI / 2
                : Math.asin((2 * test) / unit);
        const bank = Math.atan2(2 * this.x * this.w - 2 * this.y * this.z, -sqx + sqy - sqz + sqw);
        return new XYZ(bank, heading, attitude);
    }
}
