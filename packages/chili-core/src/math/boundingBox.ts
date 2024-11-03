// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export type PointLike = { x: number; y: number; z: number };

export class BoundingBox {
    public min: PointLike;
    public max: PointLike;

    constructor(min: PointLike, max: PointLike) {
        this.min = min;
        this.max = max;
    }

    static isValid(box: BoundingBox) {
        return box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z;
    }

    static expandByPoint(box: BoundingBox, point: PointLike) {
        box.min.x = Math.min(box.min.x, point.x);
        box.min.y = Math.min(box.min.y, point.y);
        box.min.z = Math.min(box.min.z, point.z);

        box.max.x = Math.max(box.max.x, point.x);
        box.max.y = Math.max(box.max.y, point.y);
        box.max.z = Math.max(box.max.z, point.z);
    }

    public static fromNumbers(points: number[]): BoundingBox {
        let min = { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE };
        let max = { x: Number.MIN_VALUE, y: Number.MIN_VALUE, z: Number.MIN_VALUE };

        for (let i = 0; i < points.length; i += 3) {
            min.x = Math.min(min.x, points[i]);
            min.y = Math.min(min.y, points[i + 1]);
            min.z = Math.min(min.z, points[i + 2]);

            max.x = Math.max(max.x, points[i]);
            max.y = Math.max(max.y, points[i + 1]);
            max.z = Math.max(max.z, points[i + 2]);
        }
        return new BoundingBox(min, max);
    }

    public static fromPoints(points: PointLike[]): BoundingBox {
        let min = { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE };
        let max = { x: Number.MIN_VALUE, y: Number.MIN_VALUE, z: Number.MIN_VALUE };
        for (let point of points) {
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
