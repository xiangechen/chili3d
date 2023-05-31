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
        const w = this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z;
        const x = this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y;
        const y = this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x;
        const z = this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w;
        return new Quaternion(w, x, y, z);
    }
    conjugate(): Quaternion {
        return new Quaternion(this.w, -this.x, -this.y, -this.z);
    }
    magnitude(): number {
        return Math.sqrt(this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z);
    }
    normalize(): Quaternion {
        const magnitude = this.magnitude();
        return new Quaternion(this.w / magnitude, this.x / magnitude, this.y / magnitude, this.z / magnitude);
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
        const x = this.x,
            y = this.y,
            z = this.z,
            w = this.w;
        const xx = x * x,
            xy = x * y,
            xz = x * z,
            xw = x * w;
        const yy = y * y,
            yz = y * z,
            yw = y * w;
        const zz = z * z,
            zw = z * w;
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
        const cy = Math.cos(yaw * 0.5);
        const sy = Math.sin(yaw * 0.5);
        const cp = Math.cos(pitch * 0.5);
        const sp = Math.sin(pitch * 0.5);
        const cr = Math.cos(roll * 0.5);
        const sr = Math.sin(roll * 0.5);
        const w = cr * cp * cy + sr * sp * sy;
        const x = sr * cp * cy - cr * sp * sy;
        const y = cr * sp * cy + sr * cp * sy;
        const z = cr * cp * sy - sr * sp * cy;
        return new Quaternion(w, x, y, z);
    }
}
