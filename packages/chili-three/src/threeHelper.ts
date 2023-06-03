// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color, XYZ } from "chili-core";
import { Camera, Color as ThreeColor, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

export class ThreeHelper {
    static toXYZ(vector: Vector3): XYZ {
        return new XYZ(vector.x, vector.y, vector.z);
    }

    static fromXYZ(vector: XYZ): Vector3 {
        return new Vector3(vector.x, vector.y, vector.z);
    }

    static isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
        return (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
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
}
