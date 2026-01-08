// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Config,
    I18n,
    type IDocument,
    type ISubEdgeShape,
    type IView,
    type Line,
    MeshDataUtils,
    Precision,
    ShapeType,
    screenDistance,
    VisualConfig,
    XY,
    type XYZ,
} from "chili-core";
import type { ISnap, MouseAndDetected, SnapResult } from "../";
import type { Axis } from "./axis";
import { AxisTracking } from "./axisTracking";
import { ObjectTracking } from "./objectTracking";

export interface TrackingData {
    axis: Axis;
    point: XYZ;
    isObjectTracking: boolean;
    distance: number;
    info: string;
}

export class TrackingSnap implements ISnap {
    private readonly _axisTracking: AxisTracking;
    private readonly _objectTracking: ObjectTracking;
    private readonly _tempLines: Map<IView, number[]> = new Map();

    constructor(
        readonly referencePoint: (() => XYZ) | undefined,
        trackingAxisZ: boolean,
    ) {
        this._axisTracking = new AxisTracking(trackingAxisZ);
        this._objectTracking = new ObjectTracking(trackingAxisZ);
        Config.instance.onPropertyChanged(this.onSnapTypeChanged);
    }

    readonly handleSnaped = (document: IDocument, snaped?: SnapResult) => {
        if (Config.instance.enableSnapTracking) {
            this._objectTracking.showTrackingAtTimeout(document, snaped);
        }
    };

    snap(data: MouseAndDetected): SnapResult | undefined {
        if (!Config.instance.enableSnapTracking) return undefined;

        const trackingDatas = this.detectTracking(data.view, data.mx, data.my);
        if (trackingDatas.length === 0) return undefined;
        trackingDatas.sort((x) => x.distance);
        const snaped = this.shapeIntersectTracking(data, trackingDatas);
        if (snaped !== undefined) return snaped;
        if (trackingDatas.length === 1) {
            return this.getSnapedAndShowTracking(data.view, trackingDatas[0].point, [trackingDatas[0]]);
        }
        return (
            this.trackingIntersectTracking(data.view, trackingDatas) ??
            this.getSnapedAndShowTracking(data.view, trackingDatas[0].point, [trackingDatas[0]])
        );
    }

    private trackingIntersectTracking(view: IView, trackingDatas: TrackingData[]) {
        const point = trackingDatas[0].axis.intersect(trackingDatas[1].axis);
        return point
            ? this.getSnapedAndShowTracking(view, point, [trackingDatas[0], trackingDatas[1]])
            : undefined;
    }

    private getSnapedAndShowTracking(view: IView, point: XYZ, trackingDatas: TrackingData[]): SnapResult {
        const lines: number[] = trackingDatas
            .map((x) => this.showTempLine(view, x.axis.point, point))
            .filter((id) => id !== undefined);
        this._tempLines.set(view, lines);

        let info: string | undefined;
        let distance: number | undefined;
        if (trackingDatas.length === 1) {
            distance = point.distanceTo(trackingDatas[0].axis.point);
            info = trackingDatas[0].axis.name;
        } else if (trackingDatas.length === 2) {
            info = I18n.translate("snap.intersection");
        }
        const refPoint = trackingDatas[0].axis.point;
        return { view, point, info, shapes: [], refPoint, distance };
    }

    private showTempLine(view: IView, start: XYZ, end: XYZ): number | undefined {
        const vector = end.sub(start);
        const normal = vector.normalize();
        if (!normal) return undefined;
        const distance = Math.min(vector.length() * 1e10, 1e20);
        const newEnd = start.add(normal.multiply(distance));
        const lineDats = MeshDataUtils.createEdgeMesh(start, newEnd, VisualConfig.temporaryEdgeColor, "dash");
        return view.document.visual.context.displayMesh([lineDats]);
    }

    private shapeIntersectTracking(
        data: MouseAndDetected,
        trackingDatas: TrackingData[],
    ): SnapResult | undefined {
        if (data.shapes.length === 0 || data.shapes[0].shape.shapeType !== ShapeType.Edge) return undefined;
        const point = this.findIntersection(data, trackingDatas);
        if (!point) return undefined;
        const id = this.showTempLine(data.view, point.location, point.intersect);
        if (id === undefined) return undefined;
        this._tempLines.set(data.view, [id]);
        return {
            view: data.view,
            point: point.intersect,
            info: I18n.translate("snap.intersection"),
            shapes: [data.shapes[0]],
        };
    }

    private findIntersection(data: MouseAndDetected, trackingDatas: TrackingData[]) {
        const edge = data.shapes[0].shape as ISubEdgeShape;
        const points: { intersect: XYZ; location: XYZ }[] = [];
        trackingDatas.forEach((x) => {
            edge.intersect(x.axis).forEach((p) => {
                points.push({ intersect: p.point, location: x.axis.point });
            });
        });
        points.sort((p) => screenDistance(data.view, data.mx, data.my, p.intersect));
        return points.at(0);
    }

    private detectTracking(view: IView, x: number, y: number) {
        const data: TrackingData[] = [];
        if (this.referencePoint) {
            const axies = this._axisTracking.getAxes(view, this.referencePoint());
            data.push(...this.getSnapedFromAxes(axies, view, x, y));
        }
        const objectTrackingRays = this._objectTracking.getTrackingRays(view);
        objectTrackingRays.forEach((a) => {
            data.push(...this.getSnapedFromAxes(a.axes, view, x, y, a.objectName));
        });
        return data;
    }

    private getSnapedFromAxes(axes: Axis[], view: IView, x: number, y: number, snapedName?: string) {
        const result: TrackingData[] = [];
        for (const axis of axes) {
            const distance = this.rayDistanceAtScreen(view, x, y, axis);
            if (distance < Config.instance.SnapDistance) {
                const ray = view.rayAt(x, y);
                const point = axis.nearestTo(ray.toLine());
                if (point.sub(axis.point).dot(axis.direction) < 0) continue;
                result.push({
                    axis,
                    distance,
                    point,
                    info: snapedName ?? axis.name,
                    isObjectTracking: snapedName !== undefined,
                });
            }
        }
        return result;
    }

    private rayDistanceAtScreen(view: IView, x: number, y: number, axis: Line): number {
        const start = view.worldToScreen(axis.point);
        const vector = new XY(x - start.x, y - start.y);
        if (vector.isEqualTo(XY.zero)) return 0;
        const end = view.worldToScreen(axis.point.add(axis.direction.multiply(100000)));
        if (start.distanceTo(end) < Precision.Float) return vector.length();
        const dir = end.sub(start).normalize()!;
        const dot = vector.dot(dir);
        return Math.sqrt(vector.lengthSq() - dot * dot);
    }

    removeDynamicObject(): void {
        this._tempLines.forEach((v, k) => {
            v.forEach((id) => {
                k.document.visual.context.removeMesh(id);
            });
        });
        this._tempLines.clear();
    }

    private readonly onSnapTypeChanged = (property: keyof Config): void => {
        if (property === "snapType" || property === "enableSnapTracking" || property === "enableSnap") {
            this.removeDynamicObject();
            this._objectTracking.clear();
            this._axisTracking.clear();
        }
    };

    clear(): void {
        this.removeDynamicObject();
        this._axisTracking.clear();
        this._objectTracking.clear();
        Config.instance.removePropertyChanged(this.onSnapTypeChanged);
    }
}
