// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Color, Matrix4, XYZ } from "chili-core";
import {
    Box3,
    Camera,
    Matrix4 as ThreeMatrix4,
    OrthographicCamera,
    PerspectiveCamera,
    Color as ThreeColor,
    Vector3,
} from "three";

export class ThreeHelper {
    static toMatrix(matrix: ThreeMatrix4) {
        return Matrix4.fromArray(matrix.toArray());
    }

    static toXYZ(vector: Vector3): XYZ {
        return new XYZ(vector.x, vector.y, vector.z);
    }

    static fromXYZ(vector: XYZ): Vector3 {
        return new Vector3(vector.x, vector.y, vector.z);
    }

    static isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
        return (camera as PerspectiveCamera).isPerspectiveCamera;
    }

    static isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
        return (camera as OrthographicCamera).isOrthographicCamera;
    }

    static fromColor(color: Color): ThreeColor {
        return new ThreeColor(color.r, color.g, color.b);
    }

    static toColor(color: ThreeColor): Color {
        return new Color(color.r, color.g, color.b, 1);
    }

    static findGroupIndex(groups: { start: number; count: number }[], subIndex: number) {
        for (let i = 0; i < groups.length; i++) {
            if (subIndex >= groups[i].start && subIndex < groups[i].start + groups[i].count) {
                return i;
            }
        }
        return undefined;
    }

    static transformVector(matrix: ThreeMatrix4, vector: Vector3) {
        let array = matrix.elements;
        let x = vector.x * array[0] + vector.y * array[4] + vector.z * array[8];
        let y = vector.x * array[1] + vector.y * array[5] + vector.z * array[9];
        let z = vector.x * array[2] + vector.y * array[6] + vector.z * array[10];
        return new Vector3(x, y, z);
    }

    static boxCorners(box: Box3) {
        let min = box.min;
        let max = box.max;
        return [
            new Vector3(min.x, min.y, min.z),
            new Vector3(max.x, min.y, min.z),
            new Vector3(max.x, max.y, min.z),
            new Vector3(min.x, max.y, min.z),
            new Vector3(min.x, min.y, max.z),
            new Vector3(max.x, min.y, max.z),
            new Vector3(max.x, max.y, max.z),
            new Vector3(min.x, max.y, max.z),
        ];
    }
}
