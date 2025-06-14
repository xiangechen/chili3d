// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EdgeMeshData, IView, LineType, Plane, VisualConfig, XYZ } from "chili-core";
import { ISnap, MouseAndDetected, SnapResult } from "../snap";

export class AxisSnap implements ISnap {
    private _tempLines?: [IView, number];

    constructor(
        readonly point: XYZ,
        readonly direction: XYZ,
    ) {}

    snap(data: MouseAndDetected): SnapResult | undefined {
        const right = data.view.up().cross(data.view.direction()).normalize();
        const normal = right?.cross(this.direction).normalize();
        if (!normal) return undefined;

        const plane = new Plane(this.point, normal, right!);
        const ray = data.view.rayAt(data.mx, data.my);
        const intersect = plane.intersect(ray, false);
        if (!intersect) return undefined;

        const vector = intersect.sub(this.point);
        const dot = vector.dot(this.direction);
        const point = this.point.add(this.direction.multiply(dot));
        this.showTempLine(data.view, dot);

        return {
            view: data.view,
            point,
            distance: dot,
            shapes: [],
        };
    }

    private showTempLine(view: IView, dot: number) {
        const dist = Math.abs(dot) < 0.000001 ? 1e15 : 1e15 * dot;
        const lineDats = EdgeMeshData.from(
            this.point,
            this.point.add(this.direction.multiply(dist)),
            VisualConfig.temporaryEdgeColor,
            LineType.Dash,
        );
        const id = view.document.visual.context.displayMesh([lineDats]);
        this._tempLines = [view, id];
    }

    removeDynamicObject(): void {
        this._tempLines?.[0].document.visual.context.removeMesh(this._tempLines[1]);
    }

    clear(): void {
        this.removeDynamicObject();
    }
}
