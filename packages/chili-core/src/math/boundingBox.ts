// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EdgeMeshData, LineType } from "../shape";
import { Matrix4 } from "./matrix4";
import { XYZ } from "./xyz";

export type PointLike = { x: number; y: number; z: number };

export class BoundingBox {
    constructor(
        readonly min: PointLike,
        readonly max: PointLike,
    ) {}

    static readonly zero = new BoundingBox(new XYZ(0, 0, 0), new XYZ(0, 0, 0));

    static transformed(box: BoundingBox, matrix: Matrix4) {
        const min = matrix.ofPoint(box.min);
        const max = matrix.ofPoint(box.max);

        return new BoundingBox(min, max);
    }

    static center(box: BoundingBox | undefined) {
        if (!box) {
            return XYZ.zero;
        }

        const x = (box.min.x + box.max.x) / 2;
        const y = (box.min.y + box.max.y) / 2;
        const z = (box.min.z + box.max.z) / 2;

        return new XYZ(x, y, z);
    }

    static expand(box: BoundingBox, value: number) {
        const min = {
            x: box.min.x - value,
            y: box.min.y - value,
            z: box.min.z - value,
        };
        const max = {
            x: box.max.x + value,
            y: box.max.y + value,
            z: box.max.z + value,
        };

        return new BoundingBox(min, max);
    }

    static wireframe(box: BoundingBox): EdgeMeshData {
        const { min, max } = box;
        const position = [
            min.x, min.y, min.z, min.x, min.y, max.z, // z
            min.x, min.y, max.z, min.x, max.y, max.z, // y
            min.x, max.y, max.z, min.x, max.y, min.z, // z
            min.x, max.y, min.z, min.x, min.y, min.z, // y
            max.x, min.y, min.z, max.x, min.y, max.z, // z
            max.x, min.y, max.z, max.x, max.y, max.z, // y
            max.x, max.y, max.z, max.x, max.y, min.z, // z
            max.x, max.y, min.z, max.x, min.y, min.z, // y
            min.x, min.y, min.z, max.x, min.y, min.z, // x
            min.x, min.y, max.z, max.x, min.y, max.z, // x
            min.x, max.y, max.z, max.x, max.y, max.z, // x
            min.x, max.y, min.z, max.x, max.y, min.z, // x
        ];
        return {
            position: new Float32Array(position),
            lineType: LineType.Solid,
            range: [],
        };
    }

    static isValid(box: BoundingBox) {
        return box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z;
    }

    static expandByPoint(box: BoundingBox, point: PointLike) {
        const { min, max } = box;
        min.x = Math.min(min.x, point.x);
        min.y = Math.min(min.y, point.y);
        min.z = Math.min(min.z, point.z);
        max.x = Math.max(max.x, point.x);
        max.y = Math.max(max.y, point.y);
        max.z = Math.max(max.z, point.z);
    }

    static combine(box1: BoundingBox | undefined, box2: BoundingBox | undefined) {
        if (!box2) {
            return box1;
        }

        if (!box1) {
            return box2;
        }

        const min = {
            x: Math.min(box1.min.x, box2.min.x),
            y: Math.min(box1.min.y, box2.min.y),
            z: Math.min(box1.min.z, box2.min.z),
        };
        const max = {
            x: Math.max(box1.max.x, box2.max.x),
            y: Math.max(box1.max.y, box2.max.y),
            z: Math.max(box1.max.z, box2.max.z),
        };
        return new BoundingBox(min, max);
    }

    static fromNumbers(points: ArrayLike<number>): BoundingBox {
        const min = { x: Infinity, y: Infinity, z: Infinity };
        const max = { x: -Infinity, y: -Infinity, z: -Infinity };

        for (let i = 0; i < points.length; i += 3) {
            const x = points[i];
            const y = points[i + 1];
            const z = points[i + 2];

            min.x = Math.min(min.x, x);
            min.y = Math.min(min.y, y);
            min.z = Math.min(min.z, z);
            max.x = Math.max(max.x, x);
            max.y = Math.max(max.y, y);
            max.z = Math.max(max.z, z);
        }
        return new BoundingBox(min, max);
    }

    static fromPoints(points: PointLike[]): BoundingBox {
        const min = { x: Infinity, y: Infinity, z: Infinity };
        const max = { x: -Infinity, y: -Infinity, z: -Infinity };

        for (const point of points) {
            min.x = Math.min(min.x, point.x);
            min.y = Math.min(min.y, point.y);
            min.z = Math.min(min.z, point.z);
            max.x = Math.max(max.x, point.x);
            max.y = Math.max(max.y, point.y);
            max.z = Math.max(max.z, point.z);
        }
        return new BoundingBox(min, max);
    }
}
