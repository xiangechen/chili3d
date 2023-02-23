// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { XYZ } from "./xyz";

export class Transform {
    private m: Float32Array = new Float32Array(16);

    public constructor() {}

    public determinant(): number {
        var temp1 = this.m[10] * this.m[15] - this.m[11] * this.m[14];
        var temp2 = this.m[9] * this.m[15] - this.m[11] * this.m[13];
        var temp3 = this.m[9] * this.m[14] - this.m[10] * this.m[13];
        var temp4 = this.m[8] * this.m[15] - this.m[11] * this.m[12];
        var temp5 = this.m[8] * this.m[14] - this.m[10] * this.m[12];
        var temp6 = this.m[8] * this.m[13] - this.m[9] * this.m[12];

        return (
            this.m[0] * (this.m[5] * temp1 - this.m[6] * temp2 + this.m[7] * temp3) -
            this.m[1] * (this.m[4] * temp1 - this.m[6] * temp4 + this.m[7] * temp5) +
            this.m[2] * (this.m[4] * temp2 - this.m[5] * temp4 + this.m[7] * temp6) -
            this.m[3] * (this.m[4] * temp3 - this.m[5] * temp5 + this.m[6] * temp6)
        );
    }

    public toArray(): Float32Array {
        return new Float32Array(this.m);
    }

    public add(other: Transform): Transform {
        var result = new Transform();
        for (var index = 0; index < 16; index++) {
            result.m[index] = this.m[index] + other.m[index];
        }
        return result;
    }

    public invert(): Transform {
        let result = new Transform();
        var l1 = this.m[0];
        var l2 = this.m[1];
        var l3 = this.m[2];
        var l4 = this.m[3];
        var l5 = this.m[4];
        var l6 = this.m[5];
        var l7 = this.m[6];
        var l8 = this.m[7];
        var l9 = this.m[8];
        var l10 = this.m[9];
        var l11 = this.m[10];
        var l12 = this.m[11];
        var l13 = this.m[12];
        var l14 = this.m[13];
        var l15 = this.m[14];
        var l16 = this.m[15];
        var l17 = l11 * l16 - l12 * l15;
        var l18 = l10 * l16 - l12 * l14;
        var l19 = l10 * l15 - l11 * l14;
        var l20 = l9 * l16 - l12 * l13;
        var l21 = l9 * l15 - l11 * l13;
        var l22 = l9 * l14 - l10 * l13;
        var l23 = l6 * l17 - l7 * l18 + l8 * l19;
        var l24 = -(l5 * l17 - l7 * l20 + l8 * l21);
        var l25 = l5 * l18 - l6 * l20 + l8 * l22;
        var l26 = -(l5 * l19 - l6 * l21 + l7 * l22);
        var l27 = 1.0 / (l1 * l23 + l2 * l24 + l3 * l25 + l4 * l26);
        var l28 = l7 * l16 - l8 * l15;
        var l29 = l6 * l16 - l8 * l14;
        var l30 = l6 * l15 - l7 * l14;
        var l31 = l5 * l16 - l8 * l13;
        var l32 = l5 * l15 - l7 * l13;
        var l33 = l5 * l14 - l6 * l13;
        var l34 = l7 * l12 - l8 * l11;
        var l35 = l6 * l12 - l8 * l10;
        var l36 = l6 * l11 - l7 * l10;
        var l37 = l5 * l12 - l8 * l9;
        var l38 = l5 * l11 - l7 * l9;
        var l39 = l5 * l10 - l6 * l9;

        result.m[0] = l23 * l27;
        result.m[4] = l24 * l27;
        result.m[8] = l25 * l27;
        result.m[12] = l26 * l27;
        result.m[1] = -(l2 * l17 - l3 * l18 + l4 * l19) * l27;
        result.m[5] = (l1 * l17 - l3 * l20 + l4 * l21) * l27;
        result.m[9] = -(l1 * l18 - l2 * l20 + l4 * l22) * l27;
        result.m[13] = (l1 * l19 - l2 * l21 + l3 * l22) * l27;
        result.m[2] = (l2 * l28 - l3 * l29 + l4 * l30) * l27;
        result.m[6] = -(l1 * l28 - l3 * l31 + l4 * l32) * l27;
        result.m[10] = (l1 * l29 - l2 * l31 + l4 * l33) * l27;
        result.m[14] = -(l1 * l30 - l2 * l32 + l3 * l33) * l27;
        result.m[3] = -(l2 * l34 - l3 * l35 + l4 * l36) * l27;
        result.m[7] = (l1 * l34 - l3 * l37 + l4 * l38) * l27;
        result.m[11] = -(l1 * l35 - l2 * l37 + l4 * l39) * l27;
        result.m[15] = (l1 * l36 - l2 * l38 + l3 * l39) * l27;

        return result;
    }

    public setTranslation(vector3: XYZ): Transform {
        let transform = this.clone();
        transform.m[12] = vector3.x;
        transform.m[13] = vector3.y;
        transform.m[14] = vector3.z;

        return transform;
    }

    public getTranslation(): XYZ {
        return new XYZ(this.m[12], this.m[13], this.m[14]);
    }

    public multiply(other: Transform): Transform {
        let result = new Transform();
        var tm0 = this.m[0];
        var tm1 = this.m[1];
        var tm2 = this.m[2];
        var tm3 = this.m[3];
        var tm4 = this.m[4];
        var tm5 = this.m[5];
        var tm6 = this.m[6];
        var tm7 = this.m[7];
        var tm8 = this.m[8];
        var tm9 = this.m[9];
        var tm10 = this.m[10];
        var tm11 = this.m[11];
        var tm12 = this.m[12];
        var tm13 = this.m[13];
        var tm14 = this.m[14];
        var tm15 = this.m[15];

        var om0 = other.m[0];
        var om1 = other.m[1];
        var om2 = other.m[2];
        var om3 = other.m[3];
        var om4 = other.m[4];
        var om5 = other.m[5];
        var om6 = other.m[6];
        var om7 = other.m[7];
        var om8 = other.m[8];
        var om9 = other.m[9];
        var om10 = other.m[10];
        var om11 = other.m[11];
        var om12 = other.m[12];
        var om13 = other.m[13];
        var om14 = other.m[14];
        var om15 = other.m[15];

        result.m[0] = tm0 * om0 + tm1 * om4 + tm2 * om8 + tm3 * om12;
        result.m[1] = tm0 * om1 + tm1 * om5 + tm2 * om9 + tm3 * om13;
        result.m[2] = tm0 * om2 + tm1 * om6 + tm2 * om10 + tm3 * om14;
        result.m[3] = tm0 * om3 + tm1 * om7 + tm2 * om11 + tm3 * om15;

        result.m[4] = tm4 * om0 + tm5 * om4 + tm6 * om8 + tm7 * om12;
        result.m[5] = tm4 * om1 + tm5 * om5 + tm6 * om9 + tm7 * om13;
        result.m[6] = tm4 * om2 + tm5 * om6 + tm6 * om10 + tm7 * om14;
        result.m[7] = tm4 * om3 + tm5 * om7 + tm6 * om11 + tm7 * om15;

        result.m[8] = tm8 * om0 + tm9 * om4 + tm10 * om8 + tm11 * om12;
        result.m[9] = tm8 * om1 + tm9 * om5 + tm10 * om9 + tm11 * om13;
        result.m[10] = tm8 * om2 + tm9 * om6 + tm10 * om10 + tm11 * om14;
        result.m[11] = tm8 * om3 + tm9 * om7 + tm10 * om11 + tm11 * om15;

        result.m[12] = tm12 * om0 + tm13 * om4 + tm14 * om8 + tm15 * om12;
        result.m[13] = tm12 * om1 + tm13 * om5 + tm14 * om9 + tm15 * om13;
        result.m[14] = tm12 * om2 + tm13 * om6 + tm14 * om10 + tm15 * om14;
        result.m[15] = tm12 * om3 + tm13 * om7 + tm14 * om11 + tm15 * om15;
        return result;
    }

    public equals(value: Transform): boolean {
        return (
            value &&
            this.m[0] === value.m[0] &&
            this.m[1] === value.m[1] &&
            this.m[2] === value.m[2] &&
            this.m[3] === value.m[3] &&
            this.m[4] === value.m[4] &&
            this.m[5] === value.m[5] &&
            this.m[6] === value.m[6] &&
            this.m[7] === value.m[7] &&
            this.m[8] === value.m[8] &&
            this.m[9] === value.m[9] &&
            this.m[10] === value.m[10] &&
            this.m[11] === value.m[11] &&
            this.m[12] === value.m[12] &&
            this.m[13] === value.m[13] &&
            this.m[14] === value.m[14] &&
            this.m[15] === value.m[15]
        );
    }

    public clone(): Transform {
        return Transform.fromValues(
            this.m[0],
            this.m[1],
            this.m[2],
            this.m[3],
            this.m[4],
            this.m[5],
            this.m[6],
            this.m[7],
            this.m[8],
            this.m[9],
            this.m[10],
            this.m[11],
            this.m[12],
            this.m[13],
            this.m[14],
            this.m[15]
        );
    }

    public static fromArray(array: ArrayLike<number>): Transform {
        var result = new Transform();
        for (var index = 0; index < 16; index++) {
            result.m[index] = array[index];
        }
        return result;
    }

    public static fromValues(
        initialM11: number,
        initialM12: number,
        initialM13: number,
        initialM14: number,
        initialM21: number,
        initialM22: number,
        initialM23: number,
        initialM24: number,
        initialM31: number,
        initialM32: number,
        initialM33: number,
        initialM34: number,
        initialM41: number,
        initialM42: number,
        initialM43: number,
        initialM44: number
    ): Transform {
        var result = new Transform();

        result.m[0] = initialM11;
        result.m[1] = initialM12;
        result.m[2] = initialM13;
        result.m[3] = initialM14;
        result.m[4] = initialM21;
        result.m[5] = initialM22;
        result.m[6] = initialM23;
        result.m[7] = initialM24;
        result.m[8] = initialM31;
        result.m[9] = initialM32;
        result.m[10] = initialM33;
        result.m[11] = initialM34;
        result.m[12] = initialM41;
        result.m[13] = initialM42;
        result.m[14] = initialM43;
        result.m[15] = initialM44;

        return result;
    }

    public static identity(): Transform {
        return Transform.fromValues(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
    }

    public static zero(): Transform {
        return Transform.fromValues(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    }

    public static rotationX(angle: number): Transform {
        var result = new Transform();
        var s = Math.sin(angle);
        var c = Math.cos(angle);

        result.m[0] = 1.0;
        result.m[15] = 1.0;

        result.m[5] = c;
        result.m[10] = c;
        result.m[9] = -s;
        result.m[6] = s;

        result.m[1] = 0.0;
        result.m[2] = 0.0;
        result.m[3] = 0.0;
        result.m[4] = 0.0;
        result.m[7] = 0.0;
        result.m[8] = 0.0;
        result.m[11] = 0.0;
        result.m[12] = 0.0;
        result.m[13] = 0.0;
        result.m[14] = 0.0;
        return result;
    }

    public static rotationY(angle: number): Transform {
        var result = new Transform();
        var s = Math.sin(angle);
        var c = Math.cos(angle);

        result.m[5] = 1.0;
        result.m[15] = 1.0;

        result.m[0] = c;
        result.m[2] = -s;
        result.m[8] = s;
        result.m[10] = c;

        result.m[1] = 0.0;
        result.m[3] = 0.0;
        result.m[4] = 0.0;
        result.m[6] = 0.0;
        result.m[7] = 0.0;
        result.m[9] = 0.0;
        result.m[11] = 0.0;
        result.m[12] = 0.0;
        result.m[13] = 0.0;
        result.m[14] = 0.0;
        return result;
    }

    public static rotationZ(angle: number): Transform {
        var result = new Transform();
        var s = Math.sin(angle);
        var c = Math.cos(angle);

        result.m[10] = 1.0;
        result.m[15] = 1.0;

        result.m[0] = c;
        result.m[1] = s;
        result.m[4] = -s;
        result.m[5] = c;

        result.m[2] = 0.0;
        result.m[3] = 0.0;
        result.m[6] = 0.0;
        result.m[7] = 0.0;
        result.m[8] = 0.0;
        result.m[9] = 0.0;
        result.m[11] = 0.0;
        result.m[12] = 0.0;
        result.m[13] = 0.0;
        result.m[14] = 0.0;
        return result;
    }

    public static rotationAxis(vector: XYZ, angle: number): Transform {
        let axis = vector.normalize();
        if (axis === undefined) throw "invalid vector";

        var result = Transform.zero();
        var s = Math.sin(-angle);
        var c = Math.cos(-angle);
        var c1 = 1 - c;

        result.m[0] = axis.x * axis.x * c1 + c;
        result.m[1] = axis.x * axis.y * c1 - axis.z * s;
        result.m[2] = axis.x * axis.z * c1 + axis.y * s;
        result.m[3] = 0.0;

        result.m[4] = axis.y * axis.x * c1 + axis.z * s;
        result.m[5] = axis.y * axis.y * c1 + c;
        result.m[6] = axis.y * axis.z * c1 - axis.x * s;
        result.m[7] = 0.0;

        result.m[8] = axis.z * axis.x * c1 - axis.y * s;
        result.m[9] = axis.z * axis.y * c1 + axis.x * s;
        result.m[10] = axis.z * axis.z * c1 + c;
        result.m[11] = 0.0;

        result.m[15] = 1.0;
        return result;
    }

    public static scalingTransform(x: number, y: number, z: number): Transform {
        return Transform.fromValues(x, 0.0, 0.0, 0.0, 0.0, y, 0.0, 0.0, 0.0, 0.0, z, 0.0, 0.0, 0.0, 0.0, 1.0);
    }

    public static translationTransform(x: number, y: number, z: number): Transform {
        return Transform.fromValues(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, x, y, z, 1.0);
    }

    public transpose(): Transform {
        var result = new Transform();
        result.m[0] = this.m[0];
        result.m[1] = this.m[4];
        result.m[2] = this.m[8];
        result.m[3] = this.m[12];

        result.m[4] = this.m[1];
        result.m[5] = this.m[5];
        result.m[6] = this.m[9];
        result.m[7] = this.m[13];

        result.m[8] = this.m[2];
        result.m[9] = this.m[6];
        result.m[10] = this.m[10];
        result.m[11] = this.m[14];

        result.m[12] = this.m[3];
        result.m[13] = this.m[7];
        result.m[14] = this.m[11];
        result.m[15] = this.m[15];

        return result;
    }

    public ofPoint(point: XYZ): XYZ {
        var x = point.x * this.m[0] + point.y * this.m[4] + point.z * this.m[8] + this.m[12];
        var y = point.x * this.m[1] + point.y * this.m[5] + point.z * this.m[9] + this.m[13];
        var z = point.x * this.m[2] + point.y * this.m[6] + point.z * this.m[10] + this.m[14];
        var w = point.x * this.m[3] + point.y * this.m[7] + point.z * this.m[11] + this.m[15];

        return new XYZ(x / w, y / w, z / w);
    }

    public ofVector(vector: XYZ): XYZ {
        var x = vector.x * this.m[0] + vector.y * this.m[4] + vector.z * this.m[8];
        var y = vector.x * this.m[1] + vector.y * this.m[5] + vector.z * this.m[9];
        var z = vector.x * this.m[2] + vector.y * this.m[6] + vector.z * this.m[10];
        return new XYZ(x, y, z);
    }
}
