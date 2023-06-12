// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Config,
    EdgeMeshData,
    i18n,
    IDocument,
    IEdge,
    IView,
    LineType,
    ObjectSnapType,
    Precision,
    PubSub,
    Ray,
    ShapeType,
    XY,
    XYZ,
} from "chili-core";

import { ISnapper, MouseAndDetected, SnapedData } from "../";
import { AxesTracking } from "./axesTracking";
import { Axis } from "./axis";
import { ObjectTracking } from "./objectTracking";

export interface TrackingData {
    axis: Axis;
    point: XYZ;
    isObjectTracking: boolean;
    distance: number;
    info: string;
}

export class TrackingSnap implements ISnapper {
    private readonly _axisTracking: AxesTracking;
    private readonly _objectTracking: ObjectTracking;
    private readonly _tempLines: Map<IView, number[]> = new Map();

    constructor(readonly referencePoint: XYZ | undefined, trackingAxisZ: boolean) {
        this._axisTracking = new AxesTracking(trackingAxisZ);
        this._objectTracking = new ObjectTracking(trackingAxisZ);
        PubSub.default.sub("snapTypeChanged", this.onSnapTypeChanged);
    }

    handleSnaped = (document: IDocument, snaped?: SnapedData | undefined) => {
        this._objectTracking.showTrackingAtTimeout(document, snaped);
    };

    snap(data: MouseAndDetected): SnapedData | undefined {
        let trackingDatas = this.detectTracking(data.view, data.mx, data.my);
        if (trackingDatas.length === 0) return undefined;
        trackingDatas.sort((x) => x.distance);
        let snaped = this.shapeIntersectTracking(data, trackingDatas);
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
        let point = trackingDatas[0].axis.intersect(trackingDatas[1].axis);
        if (point !== undefined) {
            return this.getSnapedAndShowTracking(view, point, [trackingDatas[0], trackingDatas[1]]);
        }
        return undefined;
    }

    private getSnapedAndShowTracking(view: IView, point: XYZ, trackingDatas: TrackingData[]) {
        let lines: number[] = [];
        trackingDatas.forEach((x) => {
            let id = this.showTempLine(view, x.axis.location, point);
            if (id !== undefined) lines.push(id);
        });
        this._tempLines.set(view, lines);

        let info: string | undefined = undefined;
        if (trackingDatas.length === 1) {
            let distance = point.distanceTo(trackingDatas[0].axis.location);
            info = `${trackingDatas[0].axis.name}: ${distance.toFixed(2)}`;
        }
        return { view, point, info, shapes: [] };
    }

    private showTempLine(view: IView, start: XYZ, end: XYZ): number | undefined {
        let vector = end.sub(start);
        let normal = vector.normalize();
        if (normal === undefined) return undefined;
        let distance = vector.length() * 1e10;
        let newEnd = start.add(normal.multiply(distance > 1e20 ? 1e20 : distance));
        let lineDats = EdgeMeshData.from(
            start,
            newEnd,
            Config.instance.visual.temporaryEdgeColor,
            LineType.Dash
        );
        return view.viewer.visual.context.displayShapeMesh(lineDats);
    }

    private shapeIntersectTracking(
        data: MouseAndDetected,
        trackingDatas: TrackingData[]
    ): SnapedData | undefined {
        if (data.shapes.length === 0 || data.shapes[0].shape.shapeType !== ShapeType.Edge) return undefined;
        let point = this.findIntersection(data, trackingDatas);
        if (point === undefined) return undefined;
        let id = this.showTempLine(data.view, point.location, point.intersect);
        if (id === undefined) return undefined;
        this._tempLines.set(data.view, [id]);
        return {
            view: data.view,
            point: point.intersect,
            info: i18n["snap.intersection"],
            shapes: [data.shapes[0]],
        };
    }

    private findIntersection(data: MouseAndDetected, trackingDatas: TrackingData[]) {
        let edge = data.shapes[0].shape as IEdge;
        let points: { intersect: XYZ; location: XYZ }[] = [];
        trackingDatas.forEach((x) => {
            edge.intersect(x.axis).forEach((p) => {
                points.push({ intersect: p, location: x.axis.location });
            });
        });
        points.sort((p) => this.pointDistanceAtScreen(data.view, data.mx, data.my, p.intersect));
        return points.at(0);
    }

    private detectTracking(view: IView, x: number, y: number) {
        let data: TrackingData[] = [];
        if (this.referencePoint !== undefined) {
            let axies = this._axisTracking.getAxes(view, this.referencePoint);
            data.push(...this.getSnapedFromAxes(axies, view, x, y, undefined));
        }
        let objectTrackingRays = this._objectTracking.getTrackingRays(view);
        objectTrackingRays.forEach((a) => {
            data.push(...this.getSnapedFromAxes(a.axes, view, x, y, a.objectName));
        });
        return data;
    }

    private getSnapedFromAxes(
        axes: Axis[],
        view: IView,
        x: number,
        y: number,
        snapedName: string | undefined
    ) {
        let result: TrackingData[] = [];
        for (const axis of axes) {
            let distance = this.rayDistanceAtScreen(view, x, y, axis);
            if (distance < Config.instance.SnapDistance) {
                let ray = view.rayAt(x, y);
                let point = axis.nearestTo(ray);
                if (point.sub(axis.location).dot(axis.direction) < 0) continue;
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

    private rayDistanceAtScreen(view: IView, x: number, y: number, axis: Ray): number {
        let start = view.worldToScreen(axis.location);
        let vector = new XY(x - start.x, y - start.y);
        if (vector.isEqualTo(XY.zero)) return 0;
        let end = view.worldToScreen(axis.location.add(axis.direction.multiply(100000)));
        if (start.distanceTo(end) < Precision.Resolution) return vector.length();
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
                k.viewer.visual.context.removeShapeMesh(id);
            });
        });
        this._tempLines.clear();
    }

    private onSnapTypeChanged(snapType: ObjectSnapType): void {
        this.removeDynamicObject();
        this._objectTracking.clear();
        this._axisTracking.clear();
    }

    clear(): void {
        this.removeDynamicObject();
        this._axisTracking.clear();
        this._objectTracking.clear();
    }
}
