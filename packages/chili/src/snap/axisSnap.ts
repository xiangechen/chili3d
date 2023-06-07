// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Config, EdgeMeshData, IView, LineType, Plane, XYZ } from "chili-core";

import { ISnapper, MouseAndDetected, SnapedData } from ".";

export class AxisSnap implements ISnapper {
    private _tempLines?: [IView, number];

    constructor(readonly point: XYZ, readonly direction: XYZ) {}

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
        this.showTempLine(data.view, dot);
        return {
            view: data.view,
            point,
            shapes: [],
        };
    }

    private showTempLine(view: IView, dot: number) {
        let dist = Math.abs(dot) < 0.000001 ? 1e20 : 1e20 * dot;
        let lineDats = EdgeMeshData.from(
            this.point,
            this.point.add(this.direction.multiply(dist)),
            Config.instance.visual.temporaryEdgeColor,
            LineType.Dash
        );
        let id = view.viewer.visual.context.temporaryDisplay(lineDats);
        this._tempLines = [view, id];
    }

    removeDynamicObject(): void {
        this._tempLines?.[0].viewer.visual.context.temporaryRemove(this._tempLines[1]);
    }

    clear(): void {
        this.removeDynamicObject();
    }
}
