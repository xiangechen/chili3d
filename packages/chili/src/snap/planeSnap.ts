// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Plane, XYZ } from "chili-core";

import { ISnapper, MouseAndDetected, SnapedData } from "./interfaces";

export abstract class PlaneSnapBase implements ISnapper {
    removeDynamicObject(): void {}
    clear(): void {}
    abstract snap(data: MouseAndDetected): SnapedData | undefined;

    constructor(readonly refPoint?: XYZ) {}

    protected snapAtPlane(plane: Plane, data: MouseAndDetected) {
        let ray = data.view.rayAt(data.mx, data.my);
        let point = plane.intersect(ray);
        if (point === undefined) return undefined;
        let info: string | undefined = undefined;
        if (this.refPoint) info = this.refPoint.distanceTo(point).toFixed(2);
        return {
            view: data.view,
            point,
            info,
            shapes: [],
        };
    }
}

export class WorkplaneSnap extends PlaneSnapBase {
    constructor(refPoint?: XYZ) {
        super(refPoint);
    }

    snap(data: MouseAndDetected): SnapedData | undefined {
        return this.snapAtPlane(data.view.workplane, data);
    }
}

export class PlaneSnap extends PlaneSnapBase {
    constructor(
        readonly plane: Plane,
        refPoint?: XYZ,
    ) {
        super(refPoint);
    }

    snap(data: MouseAndDetected): SnapedData | undefined {
        return this.snapAtPlane(this.plane, data);
    }
}
