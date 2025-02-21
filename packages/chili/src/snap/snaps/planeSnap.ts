// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Plane, XYZ } from "chili-core";
import { ISnap, MouseAndDetected, SnapResult } from "../snap";

export abstract class PlaneSnapBase implements ISnap {
    removeDynamicObject(): void {}
    clear(): void {}
    abstract snap(data: MouseAndDetected): SnapResult | undefined;

    constructor(readonly refPoint?: () => XYZ) {}

    protected snapAtPlane(plane: Plane, data: MouseAndDetected): SnapResult | undefined {
        const ray = data.view.rayAt(data.mx, data.my);
        const point = plane.intersect(ray);
        if (!point) return undefined;

        const distance = this.refPoint ? this.refPoint().distanceTo(point) : undefined;

        return {
            view: data.view,
            point,
            distance,
            shapes: [],
        };
    }
}

export class WorkplaneSnap extends PlaneSnapBase {
    snap(data: MouseAndDetected): SnapResult | undefined {
        return this.snapAtPlane(data.view.workplane, data);
    }
}

export class PlaneSnap extends PlaneSnapBase {
    constructor(
        readonly plane: (point: XYZ) => Plane,
        refPoint?: () => XYZ,
    ) {
        super(refPoint);
    }

    snap(data: MouseAndDetected): SnapResult | undefined {
        let point = data.view.screenToWorld(data.mx, data.my);
        const plane = this.plane(point);
        const result = this.snapAtPlane(plane, data);
        if (result) {
            result.plane = plane;
        }
        return result;
    }
}
