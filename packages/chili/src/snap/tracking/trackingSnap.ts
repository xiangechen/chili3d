// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    EdgeRenderData,
    i18n,
    IEdge,
    IShape,
    IView,
    LineType,
    MathUtils,
    ObjectSnapType,
    Ray,
    ShapeType,
    XY,
    XYZ,
} from "chili-core";

import { Dimension, IPointSnap, SnapInfo } from "../";
import { Axis } from "./axis";
import { AxisTrackingSnap } from "./axisTracking";
import { ObjectTracking } from "./objectTracking";

export interface TrackingData {
    axis: Axis;
    point: XYZ;
    isObjectTracking: boolean;
    distance: number;
    info: string;
}

export class TrackingSnap implements IPointSnap {
    snaped?: SnapInfo;
    private _axisTrackings: AxisTrackingSnap;
    readonly objectTracking: ObjectTracking;
    private detectedShape: IShape | undefined;
    private readonly _tempLines: Map<IView, number[]> = new Map();

    constructor(dimension: Dimension, readonly referencePoint: XYZ | undefined) {
        let trackingZ = Dimension.contains(dimension, Dimension.D3);
        this._axisTrackings = new AxisTrackingSnap(trackingZ);
        this.objectTracking = new ObjectTracking(trackingZ);
    }

    setDetectedShape(shape: IShape | undefined) {
        this.detectedShape = shape;
    }

    point(): SnapInfo | undefined {
        return this.snaped;
    }

    showObjectTracking(view: IView, snaped?: SnapInfo) {
        this.objectTracking.showTrackingAtTimeout(view, snaped);
    }

    snap(view: IView, x: number, y: number): boolean {
        let trackingDatas = this.getTrackingDatas(view, x, y);
        if (trackingDatas.length === 0) return false;
        if (this.setSnapToIntersect(view, x, y, trackingDatas)) return true;
        if (trackingDatas.length === 1) {
            this.setSnapedAndShowTracking(view, trackingDatas[0].point, [trackingDatas[0]]);
        } else {
            trackingDatas = trackingDatas.sort((x) => x.distance);
            let point = trackingDatas[0].axis.intersect(trackingDatas[1].axis);
            if (point !== undefined) {
                this.setSnapedAndShowTracking(view, point, [trackingDatas[0], trackingDatas[1]]);
            } else {
                this.setSnapedAndShowTracking(view, trackingDatas[0].point, [trackingDatas[0]]);
            }
        }
        return true;
    }

    private setSnapedAndShowTracking(view: IView, point: XYZ, trackingDatas: TrackingData[]) {
        let info: string | undefined = undefined;
        if (trackingDatas.length === 1) {
            let distance = point.distanceTo(trackingDatas[0].axis.location);
            info = `${trackingDatas[0].axis.name}: ${distance.toFixed(2)}`;
        }
        this.snaped = { point, info, shapes: [] };
        let lines: number[] = [];
        trackingDatas.forEach((x) => {
            let id = this.tempShowLine(view, x.axis.location, point);
            if (id !== undefined) lines.push(id);
        });
        this._tempLines.set(view, lines);
    }

    private tempShowLine(view: IView, start: XYZ, end: XYZ): number | undefined {
        let vector = end.sub(start);
        let normal = vector.normalize();
        if (normal === undefined) return undefined;
        let distance = vector.length() * 1e10;
        let newEnd = start.add(normal.multiply(distance > 1e20 ? 1e20 : distance));
        let lineDats = EdgeRenderData.from(start, newEnd, 0x888, LineType.Dash);
        return view.document.visualization.context.temporaryDisplay(lineDats);
    }

    private setSnapToIntersect(view: IView, x: number, y: number, trackingDatas: TrackingData[]): boolean {
        if (this.detectedShape === undefined || this.detectedShape.shapeType !== ShapeType.Edge) return false;
        let edge = this.detectedShape as IEdge;
        let points: { intersect: XYZ; location: XYZ }[] = [];
        trackingDatas.forEach((x) => {
            edge.intersect(x.axis).forEach((p) => {
                points.push({ intersect: p, location: x.axis.location });
            });
        });
        if (points.length === 0) return false;
        let point = points.sort((p) => this.pointDistanceAtScreen(view, x, y, p.intersect))[0];
        this.snaped = {
            point: point.intersect,
            info: i18n["snap.intersection"],
            shapes: [this.detectedShape!],
        };
        let id = this.tempShowLine(view, point.intersect, point.location);
        if (id === undefined) return false;
        this._tempLines.set(view, [id]);
        return true;
    }

    private getTrackingDatas(view: IView, x: number, y: number) {
        let axiesDistance: TrackingData[] = [];
        if (this.referencePoint !== undefined) {
            let axies = this._axisTrackings.getAxies(view, this.referencePoint);
            axiesDistance.push(...this.getSnapedFromAxes(axies, view, x, y, undefined));
        }
        let objectTrackingRays = this.objectTracking.getTrackingRays(view);
        objectTrackingRays.forEach((a) => {
            axiesDistance.push(...this.getSnapedFromAxes(a.axes, view, x, y, a.objectName));
        });
        return axiesDistance;
    }

    private getSnapedFromAxes(axes: Axis[], view: IView, x: number, y: number, snapedName: string | undefined) {
        let result: TrackingData[] = [];
        for (let index = 0; index < axes.length; index++) {
            const axis = axes[index];
            let distance = this.rayDistanceAtScreen(view, x, y, axis);
            if (distance < 5) {
                let ray = view.rayAt(x, y);
                let point = axis.nearestTo(ray);
                if (point.sub(axis.location).dot(axis.direction) < 0) continue;
                let info = snapedName === undefined ? axis.name : snapedName;
                result.push({ axis, distance, point, info, isObjectTracking: snapedName !== undefined });
            }
        }
        return result;
    }

    private rayDistanceAtScreen(view: IView, x: number, y: number, axis: Ray): number {
        let start = view.worldToScreen(axis.location);
        let vector = new XY(x - start.x, y - start.y);
        if (vector.isEqualTo(XY.zero)) return 0;
        let end = view.worldToScreen(axis.location.add(axis.direction.multiply(100000)));
        if (start.distanceTo(end) < MathUtils.Resolution) return vector.length();
        let dir = end.sub(start).normalize()!;
        let dot = vector.dot(dir);
        return Math.sqrt(vector.lengthSq() - dot * dot);
    }

    private pointDistanceAtScreen(view: IView, x: number, y: number, point: XYZ): number {
        let p = view.worldToScreen(point);
        let vector = new XY(p.x - x, p.y - y);
        return vector.length();
    }

    removeDynamicObject(): void {
        this._tempLines.forEach((v, k) => {
            v.forEach((id) => {
                k.document.visualization.context.temporaryRemove(id);
            });
        });
        this._tempLines.clear();
    }

    onSnapTypeChanged(snapType: ObjectSnapType): void {
        this.removeDynamicObject();
        this.objectTracking.clear();
        this._axisTrackings.clear();
    }
    clear(): void {
        this.removeDynamicObject();
        this._axisTrackings.clear();
        this.objectTracking.clear();
    }
}
