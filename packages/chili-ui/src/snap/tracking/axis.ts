// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { MathUtils, Plane, Ray, XY, XYZ } from "chili-shared";
import { IView } from "chili-vis";

export class Axis extends Ray {
    constructor(location: XYZ, direction: XYZ, readonly name: string) {
        super(location, direction);
    }

    static getAxiesAtPlane(location: XYZ, plane: Plane) {
        return [
            new Axis(location, plane.xDirection, "X 轴"),
            new Axis(location, plane.yDirection, "Y 轴"),
            new Axis(location, plane.normal, "Z 轴"),
            new Axis(location, plane.xDirection.reverse(), "X 轴"),
            new Axis(location, plane.yDirection.reverse(), "Y 轴"),
            new Axis(location, plane.normal.reverse(), "Z 轴"),
        ];
    }

    // distanceAtScreen(view: IView, x: number, y: number): number {
    //     let start = view.worldToScreen(this.location)
    //     let vector = new XY(x - start.x, y - start.y)
    //     if (vector.isEqualTo(XY.zero)) return 0
    //     let end = view.worldToScreen(this.location.add(this.direction.multiply(100000)))
    //     if (start.distanceTo(end) < MathUtils.Resolution) return vector.length()
    //     let dir = end.sub(start).normalize()!
    //     let dot = vector.dot(dir)
    //     return Math.sqrt(vector.lengthSq() - dot * dot)
    // }
}
