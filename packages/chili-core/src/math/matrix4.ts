// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Serializer } from "../serialize";
import { MathUtils } from "./mathUtils";
import { Plane } from "./plane";
import { Quaternion } from "./quaternion";
import { XYZ, XYZLike } from "./xyz";

/**
 * Matrix in column-major order
 */
@Serializer.register(["array"], (array: Float32Array) => {
    return Matrix4.fromArray(array);
})
export class Matrix4 {
    private readonly _array: Float32Array = new Float32Array(16);
    @Serializer.serialze()
    get array(): ReadonlyArray<number> {
        return [...this._array];
    }

    public determinant(): number {
        let [a00, a01, a02, a03] = [this._array[0], this._array[1], this._array[2], this._array[3]];
        let [a10, a11, a12, a13] = [this._array[4], this._array[5], this._array[6], this._array[7]];
        let [a20, a21, a22, a23] = [this._array[8], this._array[9], this._array[10], this._array[11]];
        let [a30, a31, a32, a33] = [this._array[12], this._array[13], this._array[14], this._array[15]];

        let b0 = a00 * a11 - a01 * a10;
        let b1 = a00 * a12 - a02 * a10;
        let b2 = a01 * a12 - a02 * a11;
        let b3 = a20 * a31 - a21 * a30;
        let b4 = a20 * a32 - a22 * a30;
        let b5 = a21 * a32 - a22 * a31;
        let b6 = a00 * b5 - a01 * b4 + a02 * b3;
        let b7 = a10 * b5 - a11 * b4 + a12 * b3;
        let b8 = a20 * b2 - a21 * b1 + a22 * b0;
        let b9 = a30 * b2 - a31 * b1 + a32 * b0;

        return a13 * b6 - a03 * b7 + a33 * b8 - a23 * b9;
    }

    public toArray(): readonly number[] {
        return [...this._array];
    }

    public add(other: Matrix4): Matrix4 {
        let result = new Matrix4();
        for (let index = 0; index < 16; index++) {
            result._array[index] = this._array[index] + other._array[index];
        }
        return result;
    }

    public invert(): Matrix4 | undefined {
        let [a00, a01, a02, a03] = [this._array[0], this._array[1], this._array[2], this._array[3]];
        let [a10, a11, a12, a13] = [this._array[4], this._array[5], this._array[6], this._array[7]];
        let [a20, a21, a22, a23] = [this._array[8], this._array[9], this._array[10], this._array[11]];
        let [a30, a31, a32, a33] = [this._array[12], this._array[13], this._array[14], this._array[15]];
        let b00 = a00 * a11 - a01 * a10;
        let b01 = a00 * a12 - a02 * a10;
        let b02 = a00 * a13 - a03 * a10;
        let b03 = a01 * a12 - a02 * a11;
        let b04 = a01 * a13 - a03 * a11;
        let b05 = a02 * a13 - a03 * a12;
        let b06 = a20 * a31 - a21 * a30;
        let b07 = a20 * a32 - a22 * a30;
        let b08 = a20 * a33 - a23 * a30;
        let b09 = a21 * a32 - a22 * a31;
        let b10 = a21 * a33 - a23 * a31;
        let b11 = a22 * a33 - a23 * a32;

        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (det === 0) return undefined;
        det = 1.0 / det;

        return Matrix4.fromArray([
            (a11 * b11 - a12 * b10 + a13 * b09) * det,
            (a02 * b10 - a01 * b11 - a03 * b09) * det,
            (a31 * b05 - a32 * b04 + a33 * b03) * det,
            (a22 * b04 - a21 * b05 - a23 * b03) * det,
            (a12 * b08 - a10 * b11 - a13 * b07) * det,
            (a00 * b11 - a02 * b08 + a03 * b07) * det,
            (a32 * b02 - a30 * b05 - a33 * b01) * det,
            (a20 * b05 - a22 * b02 + a23 * b01) * det,
            (a10 * b10 - a11 * b08 + a13 * b06) * det,
            (a01 * b08 - a00 * b10 - a03 * b06) * det,
            (a30 * b04 - a31 * b02 + a33 * b00) * det,
            (a21 * b02 - a20 * b04 - a23 * b00) * det,
            (a11 * b07 - a10 * b09 - a12 * b06) * det,
            (a00 * b09 - a01 * b07 + a02 * b06) * det,
            (a31 * b01 - a30 * b03 - a32 * b00) * det,
            (a20 * b03 - a21 * b01 + a22 * b00) * det,
        ]);
    }

    public multiply(other: Matrix4): Matrix4 {
        const array = new Array(16).fill(0);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                for (let k = 0; k < 4; k++) {
                    array[i * 4 + j] += this._array[i * 4 + k] * other._array[k * 4 + j];
                }
            }
        }
        return Matrix4.fromArray(array);
    }

    public equals(value: Matrix4): boolean {
        for (let i = 0; i < 16; i++) {
            if (!MathUtils.almostEqual(this._array[i], value._array[i])) return false;
        }
        return true;
    }

    public clone(): Matrix4 {
        return Matrix4.fromArray([...this._array]);
    }

    public static fromArray(array: ArrayLike<number>): Matrix4 {
        let result = new Matrix4();
        for (let index = 0; index < 16; index++) {
            result._array[index] = array[index];
        }
        return result;
    }

    public static identity(): Matrix4 {
        return Matrix4.fromArray([
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ]);
    }

    public static zero(): Matrix4 {
        return Matrix4.fromArray(new Array(16).fill(0));
    }

    public static fromEuler(x: number, y: number, z: number): Matrix4 {
        let cx = Math.cos(x);
        let sx = Math.sin(x);
        let cy = Math.cos(y);
        let sy = Math.sin(y);
        let cz = Math.cos(z);
        let sz = Math.sin(z);
        return Matrix4.fromArray([
            cy * cz,
            cx * sz + sx * sy * cz,
            sx * sz - cx * sy * cz,
            0,
            -cy * sz,
            cx * cz - sx * sy * sz,
            sx * cz + cx * sy * sz,
            0,
            sy,
            -sx * cy,
            cx * cy,
            0,
            0,
            0,
            0,
            1,
        ]);
    }

    public static fromAxisRad(position: XYZLike, normal: XYZLike, radians: number): Matrix4 {
        let unit = new XYZ(normal.x, normal.y, normal.z).normalize();
        if (unit === undefined) throw new TypeError("invalid vector");

        let { x, y, z } = unit;
        let s = Math.sin(-radians);
        let c = Math.cos(-radians);
        let t = 1 - c;

        const array = [
            t * x * x + c,
            t * x * y - z * s,
            t * x * z + y * s,
            0,
            t * x * y + z * s,
            t * y * y + c,
            t * y * z - x * s,
            0,
            t * x * z - y * s,
            t * y * z + x * s,
            t * z * z + c,
            0,
            0,
            0,
            0,
            1,
        ];

        array[12] = position.x - position.x * array[0] - position.y * array[4] - position.z * array[8];
        array[13] = position.y - position.x * array[1] - position.y * array[5] - position.z * array[9];
        array[14] = position.z - position.x * array[2] - position.y * array[6] - position.z * array[10];

        return Matrix4.fromArray(array);
    }

    public static fromScale(x: number, y: number, z: number): Matrix4 {
        return Matrix4.fromArray([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
    }

    public static fromTranslation(x: number, y: number, z: number): Matrix4 {
        return Matrix4.fromArray([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, x, y, z, 1.0]);
    }

    public static createMirrorWithPlane(plane: Plane): Matrix4 {
        let d = -plane.origin.dot(plane.normal);
        const x = plane.normal.x;
        const y = plane.normal.y;
        const z = plane.normal.z;
        const temp = -2 * x;
        const temp2 = -2 * y;
        const temp3 = -2 * z;
        return Matrix4.fromArray([
            temp * x + 1,
            temp2 * x,
            temp3 * x,
            0.0,
            temp * y,
            temp2 * y + 1,
            temp3 * y,
            0.0,
            temp * z,
            temp2 * z,
            temp3 * z + 1,
            0.0,
            temp * d,
            temp2 * d,
            temp3 * d,
            1.0,
        ]);
    }

    public transpose(): Matrix4 {
        let result = new Matrix4();
        result._array[0] = this._array[0];
        result._array[1] = this._array[4];
        result._array[2] = this._array[8];
        result._array[3] = this._array[12];

        result._array[4] = this._array[1];
        result._array[5] = this._array[5];
        result._array[6] = this._array[9];
        result._array[7] = this._array[13];

        result._array[8] = this._array[2];
        result._array[9] = this._array[6];
        result._array[10] = this._array[10];
        result._array[11] = this._array[14];

        result._array[12] = this._array[3];
        result._array[13] = this._array[7];
        result._array[14] = this._array[11];
        result._array[15] = this._array[15];

        return result;
    }

    ofPoints(points: ArrayLike<number>): number[] {
        let result: number[] = [];
        for (let i = 0; i < points.length / 3; i++) {
            let x =
                points[3 * i] * this._array[0] +
                points[3 * i + 1] * this._array[4] +
                points[3 * i + 2] * this._array[8] +
                this._array[12];
            let y =
                points[3 * i] * this._array[1] +
                points[3 * i + 1] * this._array[5] +
                points[3 * i + 2] * this._array[9] +
                this._array[13];
            let z =
                points[3 * i] * this._array[2] +
                points[3 * i + 1] * this._array[6] +
                points[3 * i + 2] * this._array[10] +
                this._array[14];
            let w =
                points[3 * i] * this._array[3] +
                points[3 * i + 1] * this._array[7] +
                points[3 * i + 2] * this._array[11] +
                this._array[15];
            result.push(x / w, y / w, z / w);
        }
        return result;
    }

    public ofPoint(point: XYZLike): XYZ {
        let result = this.ofPoints([point.x, point.y, point.z]);
        return new XYZ(result[0], result[1], result[2]);
    }

    public ofVector(vector: XYZLike): XYZ {
        let result = this.ofVectors([vector.x, vector.y, vector.z]);
        return new XYZ(result[0], result[1], result[2]);
    }

    public ofVectors(vectors: ArrayLike<number>): number[] {
        let result: number[] = [];
        for (let i = 0; i < vectors.length / 3; i++) {
            let x =
                vectors[3 * i] * this._array[0] +
                vectors[3 * i + 1] * this._array[4] +
                vectors[3 * i + 2] * this._array[8];
            let y =
                vectors[3 * i] * this._array[1] +
                vectors[3 * i + 1] * this._array[5] +
                vectors[3 * i + 2] * this._array[9];
            let z =
                vectors[3 * i] * this._array[2] +
                vectors[3 * i + 1] * this._array[6] +
                vectors[3 * i + 2] * this._array[10];
            result.push(x, y, z);
        }
        return result;
    }

    public translationPart(): XYZ {
        return new XYZ(this._array[12], this._array[13], this._array[14]);
    }

    public getScale(): XYZ {
        const x = Math.hypot(this._array[0], this._array[1], this._array[2]);
        const y = Math.hypot(this._array[4], this._array[5], this._array[6]);
        const z = Math.hypot(this._array[8], this._array[9], this._array[10]);
        return new XYZ(x, y, z);
    }

    public getEulerAngles(): { pitch: number; yaw: number; roll: number } {
        const m = this._array;
        const m11 = m[0],
            m12 = m[4],
            m13 = m[8];
        const m22 = m[5],
            m23 = m[9];
        const m32 = m[6],
            m33 = m[10];

        let pitch = 0;
        let yaw = Math.asin(MathUtils.clamp(m13, -1, 1));
        let roll = 0;

        if (Math.abs(m13) < 0.9999999) {
            pitch = Math.atan2(-m23, m33);
            roll = Math.atan2(-m12, m11);
        } else {
            pitch = Math.atan2(m32, m22);
        }

        return { pitch, yaw, roll };
    }

    public static createFromTRS(
        position: XYZLike,
        rotation: { pitch: number; yaw: number; roll: number },
        scale: XYZLike,
    ): Matrix4 {
        const quaternion = Quaternion.fromEuler(rotation.pitch, rotation.yaw, rotation.roll);
        const te = new Array(16).fill(0);

        const x = quaternion.x,
            y = quaternion.y,
            z = quaternion.z,
            w = quaternion.w;
        const x2 = x + x,
            y2 = y + y,
            z2 = z + z;
        const xx = x * x2,
            xy = x * y2,
            xz = x * z2;
        const yy = y * y2,
            yz = y * z2,
            zz = z * z2;
        const wx = w * x2,
            wy = w * y2,
            wz = w * z2;

        const sx = scale.x,
            sy = scale.y,
            sz = scale.z;

        te[0] = (1 - (yy + zz)) * sx;
        te[1] = (xy + wz) * sx;
        te[2] = (xz - wy) * sx;
        te[3] = 0;

        te[4] = (xy - wz) * sy;
        te[5] = (1 - (xx + zz)) * sy;
        te[6] = (yz + wx) * sy;
        te[7] = 0;

        te[8] = (xz + wy) * sz;
        te[9] = (yz - wx) * sz;
        te[10] = (1 - (xx + yy)) * sz;
        te[11] = 0;

        te[12] = position.x;
        te[13] = position.y;
        te[14] = position.z;
        te[15] = 1;

        return Matrix4.fromArray(te);
    }
}
