// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ObjectSnapType, Plane } from "chili-core";

import { ISnapper, MouseAndDetected, SnapedData } from "./interfaces";

export abstract class PlaneSnapBase implements ISnapper {
    onSnapTypeChanged(snapType: ObjectSnapType): void {}
    removeDynamicObject(): void {}
    clear(): void {}
    abstract snap(data: MouseAndDetected): SnapedData | undefined;

    protected snapAtPlane(plane: Plane, data: MouseAndDetected) {
        let ray = data.view.rayAt(data.mx, data.my);
        let point = plane.intersect(ray);
        if (point === undefined) return undefined;
        return {
            view: data.view,
            point,
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
    constructor(readonly plane: Plane) {
        super();
    }

    snap(data: MouseAndDetected): SnapedData | undefined {
        return this.snapAtPlane(this.plane, data);
    }
}
