// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IView, ObjectSnapType, Plane, Ray, XYZ } from "chili-core";

import { ISnapper, MouseAndDetected, SnapedData } from "../";

export class AxisTracking implements ISnapper {
    constructor(readonly point: XYZ, readonly direction: XYZ) {}

    onSnapChanged(view: IView, snaped?: SnapedData) {}

    snap(data: MouseAndDetected): SnapedData | undefined {
        let right = data.view.up().cross(data.view.direction()).normalize();
        let normal = right?.cross(this.direction).normalize();
        if (normal === undefined) return undefined;
        let plane = new Plane(this.point, normal, right!);
        let ray = data.view.rayAt(data.mx, data.my);
        let intersect = plane.intersect(ray, true);
        if (intersect === undefined) return undefined;
        let vector = intersect.sub(this.point);
        let dot = vector.dot(this.direction);
        let point = this.point.add(this.direction.multiply(dot));
        return {
            view: data.view,
            point,
            shapes: [],
        };
    }

    removeDynamicObject(): void {}

    onSnapTypeChanged(snapType: ObjectSnapType): void {
        this.removeDynamicObject();
    }

    clear(): void {
        this.removeDynamicObject();
    }
}
