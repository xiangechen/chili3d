// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Plane, XYZ } from "chili-core";

import { ISnap, MouseAndDetected, SnapedData } from "../snap";

export abstract class PlaneSnapBase implements ISnap {
    removeDynamicObject(): void {}
    clear(): void {}
    abstract snap(data: MouseAndDetected): SnapedData | undefined;

    constructor(readonly refPoint?: () => XYZ) {}

    protected snapAtPlane(plane: Plane, data: MouseAndDetected): SnapedData | undefined {
        let ray = data.view.rayAt(data.mx, data.my);
        let point = plane.intersect(ray);
        if (point === undefined) return undefined;
        let distance: number | undefined = undefined;
        if (this.refPoint) distance = this.refPoint().distanceTo(point);
        return {
            view: data.view,
            point,
            distance,
            shapes: [],
        };
    }
}

export class WorkplaneSnap extends PlaneSnapBase {
    snap(data: MouseAndDetected): SnapedData | undefined {
        return this.snapAtPlane(data.view.workplane, data);
    }
}

export class PlaneSnap extends PlaneSnapBase {
    constructor(
        readonly plane: () => Plane,
        refPoint?: () => XYZ,
    ) {
        super(refPoint);
    }

    snap(data: MouseAndDetected): SnapedData | undefined {
        return this.snapAtPlane(this.plane(), data);
    }
}
