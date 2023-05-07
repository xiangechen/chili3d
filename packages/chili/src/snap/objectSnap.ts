// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    CurveType,
    i18n,
    ICircle,
    ICurve,
    IEdge,
    IShape,
    IView,
    ObjectSnapType,
    ShapeType,
    VertexRenderData,
    XYZ,
} from "chili-core";

import { ISnap, MouseAndDetected, SnapedData } from "./interfaces";

const SnapDistance: number = 5;

interface Hilighted {
    view: IView;
    shapes: IShape[];
}

interface InvisibleSnapInfo {
    view: IView;
    snaps: SnapedData[];
    displays: number[];
}

export class ObjectSnap implements ISnap {
    private _featureInfos: Map<IShape, SnapedData[]>;
    private _intersectionInfos: Map<string, SnapedData[]>;
    private _invisibleInfos: Map<IShape, InvisibleSnapInfo>;
    private _hilightedShapes?: Hilighted;
    private _detectedShape: IShape | undefined;

    constructor(private _snapType: ObjectSnapType, readonly referencePoint?: XYZ) {
        this._featureInfos = new Map();
        this._intersectionInfos = new Map();
        this._invisibleInfos = new Map();
    }

    clear() {
        this.unHilighted();
        this._invisibleInfos.forEach((info) => {
            info.displays.forEach((x) => info.view.visualization.context.temporaryRemove(x));
        });
    }

    getDetectedShape(): IShape | undefined {
        return this._detectedShape;
    }

    onSnapTypeChanged(snapType: ObjectSnapType) {
        this._snapType = snapType;
        this._featureInfos.clear();
        this._intersectionInfos.clear();
    }

    handleKeyUp(): void {
        throw new Error("Method not implemented.");
    }

    removeDynamicObject(): void {
        this.unHilighted();
    }

    snap(data: MouseAndDetected): SnapedData | undefined {
        if (data.shapes.length > 0) {
            this.showInvisibleSnaps(data.view, data.shapes[0]);
            return this.snapOnShape(data.view, data.mx, data.my, data.shapes);
        }
        return this.snapeInvisible(data.view, data.mx, data.my);
    }

    private snapOnShape(view: IView, x: number, y: number, shapes: IShape[]) {
        let featurePoints = this.getFeaturePoints(view, shapes[0]);
        let intersections = this.getIntersections(view, shapes[0], shapes);
        let ordered = featurePoints.concat(intersections).sort((a, b) => this.sortSnaps(view, x, y, a, b));
        if (ordered.length !== 0 && this.distanceToMouse(view, x, y, ordered[0].point) < SnapDistance) {
            this.hilighted(view, ordered[0].shapes);
            return ordered[0];
        }
        return undefined;
    }

    private snapeInvisible(view: IView, x: number, y: number): SnapedData | undefined {
        let { minDistance, snap } = this.getNearestInvisibleSnap(view, x, y);
        if (minDistance < SnapDistance) {
            this.hilighted(view, snap!.shapes);
            return snap;
        }

        return undefined;
    }

    private getNearestInvisibleSnap(
        view: IView,
        x: number,
        y: number
    ): { minDistance: number; snap?: SnapedData } {
        let snap: SnapedData | undefined = undefined;
        let minDistance = Number.MAX_VALUE;
        this._invisibleInfos.forEach((info) => {
            info.snaps.forEach((s) => {
                let dist = this.distanceToMouse(view, x, y, s.point);
                if (dist < minDistance) {
                    minDistance = dist;
                    snap = s;
                }
            });
        });
        return { minDistance, snap };
    }

    private showInvisibleSnaps(view: IView, shape: IShape) {
        if (shape.shapeType === ShapeType.Edge) {
            if (this._invisibleInfos.has(shape)) return;
            let curve = (shape as IEdge).asCurve().value;
            if (curve === undefined) return;
            if (ICurve.isCircle(curve)) {
                this.showCircleCenter(curve, view, shape);
            }
        }
    }

    private showCircleCenter(curve: ICircle, view: IView, shape: IShape) {
        let temporary = VertexRenderData.from(curve.center, 0xffff00, 3);
        let id = view.visualization.context.temporaryDisplay(temporary);
        this._invisibleInfos.set(shape, {
            view,
            snaps: [
                {
                    view,
                    point: curve.center,
                    info: i18n["snap.center"],
                    shapes: [shape],
                },
            ],
            displays: [id],
        });
    }

    private hilighted(view: IView, shapes: IShape[]) {
        this._hilightedShapes = {
            view,
            shapes,
        };
        shapes.forEach((x) => view.visualization.context.hilighted(x));
    }

    private unHilighted() {
        if (this._hilightedShapes !== undefined) {
            this._hilightedShapes.shapes.forEach((x) =>
                this._hilightedShapes?.view.visualization.context.unHilighted(x)
            );
            this._hilightedShapes = undefined;
        }
    }

    private distanceToMouse(view: IView, x: number, y: number, point: XYZ) {
        let xy = view.worldToScreen(point);
        let dx = xy.x - x;
        let dy = xy.y - y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private sortSnaps(view: IView, x: number, y: number, a: SnapedData, b: SnapedData): number {
        return this.distanceToMouse(view, x, y, a.point) - this.distanceToMouse(view, x, y, b.point);
    }

    private getIntersections(view: IView, current: IShape, shapes: IShape[]) {
        let result = new Array<SnapedData>();
        if (current.shapeType !== ShapeType.Edge) return result;
        shapes.forEach((x) => {
            if (x === current || x.shapeType !== ShapeType.Edge) return;
            let key = current.id < x.id ? `${current.id}:${x.id}` : `${x.id}:${current.id}`;
            if (!this._intersectionInfos.has(key)) {
                let intersections = (current as IEdge).intersect(x as IEdge);
                if (intersections.length > 0) {
                    let infos: SnapedData[] = intersections.map((point) => {
                        return {
                            view,
                            point,
                            info: i18n["snap.intersection"],
                            shapes: [current, x],
                        };
                    });
                    this._intersectionInfos.set(key, infos);
                }
            }
            if (this._intersectionInfos.has(key)) result.push(...this._intersectionInfos.get(key)!);
        });
        return result;
    }

    private getFeaturePoints(view: IView, shape: IShape) {
        if (this._featureInfos.has(shape)) {
            return this._featureInfos.get(shape)!;
        }
        let infos = new Array<SnapedData>();
        if (shape.shapeType === ShapeType.Edge) {
            this.getEdgeFeaturePoints(view, shape, infos);
        }
        this._featureInfos.set(shape, infos);
        return infos;
    }

    private getEdgeFeaturePoints(view: IView, shape: IShape, infos: SnapedData[]) {
        let curve = (shape as IEdge).asCurve().value;
        if (curve === undefined) return;
        let start = curve.point(curve.firstParameter());
        let end = curve.point(curve.lastParameter());
        let addPoint = (point: XYZ, info: string) => infos.push({ view, point, info, shapes: [shape] });
        if (ObjectSnapType.has(this._snapType, ObjectSnapType.endPoint)) {
            addPoint(start, i18n["snap.end"]);
            addPoint(end, i18n["snap.end"]);
        }
        if (
            ObjectSnapType.has(this._snapType, ObjectSnapType.midPoint) &&
            curve.curveType === CurveType.Line
        ) {
            addPoint(XYZ.center(start, end), i18n["snap.mid"]);
        }
    }
}
