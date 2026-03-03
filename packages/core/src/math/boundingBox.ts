// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation";
import type { EdgeMeshData } from "../shape";
import type { LineSegment } from "./lineSegment";
import type { Matrix4 } from "./matrix4";
import { getVectorComponent, XYZ, type XYZLike } from "./xyz";

export class BoundingBox {
    constructor(
        readonly min: XYZLike,
        readonly max: XYZLike,
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
            min.x,
            min.y,
            min.z,
            min.x,
            min.y,
            max.z, // z
            min.x,
            min.y,
            max.z,
            min.x,
            max.y,
            max.z, // y
            min.x,
            max.y,
            max.z,
            min.x,
            max.y,
            min.z, // z
            min.x,
            max.y,
            min.z,
            min.x,
            min.y,
            min.z, // y
            max.x,
            min.y,
            min.z,
            max.x,
            min.y,
            max.z, // z
            max.x,
            min.y,
            max.z,
            max.x,
            max.y,
            max.z, // y
            max.x,
            max.y,
            max.z,
            max.x,
            max.y,
            min.z, // z
            max.x,
            max.y,
            min.z,
            max.x,
            min.y,
            min.z, // y
            min.x,
            min.y,
            min.z,
            max.x,
            min.y,
            min.z, // x
            min.x,
            min.y,
            max.z,
            max.x,
            min.y,
            max.z, // x
            min.x,
            max.y,
            max.z,
            max.x,
            max.y,
            max.z, // x
            min.x,
            max.y,
            min.z,
            max.x,
            max.y,
            min.z, // x
        ];
        return {
            position: new Float32Array(position),
            lineType: "solid",
            range: [],
        };
    }

    static isValid(box: BoundingBox) {
        return box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z;
    }

    static isIntersect(box1: BoundingBox, box2: BoundingBox, tolerance = 0.001) {
        return (
            box1.min.x < box2.max.x + tolerance &&
            box1.max.x > box2.min.x - tolerance &&
            box1.min.y < box2.max.y + tolerance &&
            box1.max.y > box2.min.y - tolerance &&
            box1.min.z < box2.max.z + tolerance &&
            box1.max.z > box2.min.z - tolerance
        );
    }

    static isIntersectLineSegment(box: BoundingBox, line: LineSegment) {
        const d = line.end.sub(line.start);

        let [tMin, tMax] = [0, 1];
        for (let i = 0; i < 3; i++) {
            const coordMin = getVectorComponent(box.min, i);
            const coordMax = getVectorComponent(box.max, i);
            const coordStart = getVectorComponent(line.start, i);
            const coordD = getVectorComponent(d, i);

            if (Math.abs(coordD) < Precision.Distance) {
                if (coordStart < coordMin || coordStart > coordMax) {
                    return false;
                }
            } else {
                const t1 = (coordMin - coordStart) / coordD;
                const t2 = (coordMax - coordStart) / coordD;
                tMin = Math.max(tMin, Math.min(t1, t2));
                tMax = Math.min(tMax, Math.max(t1, t2));

                if (tMin > tMax) {
                    return false;
                }

                if (tMax < 0 || tMin > 1) {
                    return false;
                }
            }
        }

        return true;
    }

    static isInside(box: BoundingBox, point: XYZLike, tolerance = 0.001) {
        return (
            box.min.x + tolerance <= point.x &&
            point.x <= box.max.x - tolerance &&
            box.min.y + tolerance <= point.y &&
            point.y <= box.max.y - tolerance &&
            box.min.z + tolerance <= point.z &&
            point.z <= box.max.z - tolerance
        );
    }

    static expandByPoint(box: BoundingBox, point: XYZLike) {
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

    static fromPoints(points: XYZLike[]): BoundingBox {
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
