// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Config,
    CurveType,
    i18n,
    ICircle,
    ICurve,
    IDocument,
    IEdge,
    IView,
    IVisualContext,
    ObjectSnapType,
    PubSub,
    ShapeType,
    VertexMeshData,
    VisualShapeData,
    VisualState,
    XYZ,
} from "chili-core";

import { ISnapper, MouseAndDetected, SnapedData } from "./interfaces";

interface InvisibleSnapInfo {
    view: IView;
    snaps: SnapedData[];
    displays: number[];
}

export class ObjectSnap implements ISnapper {
    private _featureInfos: Map<VisualShapeData, SnapedData[]>;
    private _intersectionInfos: Map<string, SnapedData[]>;
    private _invisibleInfos: Map<VisualShapeData, InvisibleSnapInfo>;
    private _hilightedShapes: VisualShapeData[] = [];
    private _lastDetected?: [IView, SnapedData];
    private _hintVertex?: [IVisualContext, number];

    constructor(private _snapType: ObjectSnapType, readonly referencePoint?: XYZ) {
        this._featureInfos = new Map();
        this._intersectionInfos = new Map();
        this._invisibleInfos = new Map();
        PubSub.default.sub("snapTypeChanged", this.onSnapTypeChanged);
    }

    clear() {
        this.unHilighted();
        this._invisibleInfos.forEach((info) => {
            info.displays.forEach((x) => info.view.viewer.visual.context.temporaryRemove(x));
        });
        this.removeHint();
    }

    handleSnaped = (document: IDocument, snaped?: SnapedData | undefined) => {
        if (snaped?.shapes.length === 0 && this._lastDetected) {
            this.displayHint(this._lastDetected[0], this._lastDetected[1]);
            this._lastDetected = undefined;
        }
    };

    private onSnapTypeChanged(snapType: ObjectSnapType) {
        this._snapType = snapType;
        this._featureInfos.clear();
        this._intersectionInfos.clear();
    }

    removeDynamicObject(): void {
        this.unHilighted();
        this.removeHint();
    }

    private removeHint() {
        if (this._hintVertex !== undefined) {
            this._hintVertex[0].temporaryRemove(this._hintVertex[1]);
            this._hintVertex = undefined;
        }
    }

    snap(data: MouseAndDetected): SnapedData | undefined {
        if (data.shapes.length > 0) {
            this.showInvisibleSnaps(data.view, data.shapes[0]);
            return this.snapOnShape(data.view, data.mx, data.my, data.shapes);
        }
        return this.snapeInvisible(data.view, data.mx, data.my);
    }

    private snapOnShape(view: IView, x: number, y: number, shapes: VisualShapeData[]) {
        let featurePoints = this.getFeaturePoints(view, shapes[0]);
        let perpendiculars = this.findPerpendicular(view, shapes[0]);
        let intersections = this.getIntersections(view, shapes[0], shapes);
        let ordered = featurePoints
            .concat(perpendiculars)
            .concat(intersections)
            .sort((a, b) => this.sortSnaps(view, x, y, a, b));
        if (ordered.length === 0) return undefined;
        let dist = this.distanceToMouse(view, x, y, ordered[0].point);
        if (dist < Config.instance.SnapDistance) {
            this.hilighted(view, ordered[0].shapes);
            return ordered[0];
        } else {
            this._lastDetected = [view, ordered[0]];
            return undefined;
        }
    }

    private displayHint(view: IView, shape: SnapedData) {
        this.hilighted(view, shape.shapes);
        let data = VertexMeshData.from(
            shape.point,
            Config.instance.visual.hintVertexSize,
            Config.instance.visual.hintVertexColor
        );
        this._hintVertex = [view.viewer.visual.context, view.viewer.visual.context.temporaryDisplay(data)];
    }

    private snapeInvisible(view: IView, x: number, y: number): SnapedData | undefined {
        let { minDistance, snap } = this.getNearestInvisibleSnap(view, x, y);
        if (minDistance < Config.instance.SnapDistance) {
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

    private showInvisibleSnaps(view: IView, shape: VisualShapeData) {
        if (shape.shape.shapeType === ShapeType.Edge) {
            if (this._invisibleInfos.has(shape)) return;
            let curve = (shape.shape as IEdge).asCurve().value;
            if (curve === undefined) return;
            if (ICurve.isCircle(curve)) {
                this.showCircleCenter(curve, view, shape);
            }
        }
    }

    private showCircleCenter(curve: ICircle, view: IView, shape: VisualShapeData) {
        let temporary = VertexMeshData.from(
            curve.center,
            Config.instance.visual.hintVertexSize,
            Config.instance.visual.hintVertexColor
        );
        let id = view.viewer.visual.context.temporaryDisplay(temporary);
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

    private hilighted(view: IView, shapes: VisualShapeData[]) {
        shapes.forEach((x) => x.owner.addState(VisualState.hilight, x.shape.shapeType, x.index));
        this._hilightedShapes.push(...shapes);
    }

    private unHilighted() {
        this._hilightedShapes.forEach((x) => {
            x.owner.removeState(VisualState.hilight, x.shape.shapeType, x.index);
        });
        this._hilightedShapes.length = 0;
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

    private findPerpendicular(view: IView, shape: VisualShapeData): SnapedData[] {
        let result: SnapedData[] = [];
        if (
            !ObjectSnapType.has(this._snapType, ObjectSnapType.perpendicular) ||
            this.referencePoint === undefined
        )
            return result;
        let curve = (shape.shape as IEdge).asCurve().value;
        if (curve === undefined) return result;
        let point = curve.project(this.referencePoint).at(0);
        if (point === undefined) return result;
        result.push({
            view,
            point,
            info: i18n["snap.perpendicular"],
            shapes: [shape],
        });

        return result;
    }

    private getIntersections(view: IView, current: VisualShapeData, shapes: VisualShapeData[]) {
        let result = new Array<SnapedData>();
        if (
            !ObjectSnapType.has(this._snapType, ObjectSnapType.intersection) &&
            current.shape.shapeType !== ShapeType.Edge
        ) {
            return result;
        }
        shapes.forEach((x) => {
            if (x === current || x.shape.shapeType !== ShapeType.Edge) return;
            let key = this.getIntersectionKey(current, x);
            let arr = this._intersectionInfos.get(key);
            if (arr === undefined) {
                arr = this.findIntersections(view, current, x);
                this._intersectionInfos.set(key, arr);
            }
            result.push(...arr);
        });
        return result;
    }

    private getIntersectionKey(s1: VisualShapeData, s2: VisualShapeData) {
        return s1.shape.id < s2.shape.id ? `${s1.shape.id}:${s2.shape.id}` : `${s2.shape.id}:${s1.shape.id}`;
    }

    private findIntersections(view: IView, s1: VisualShapeData, s2: VisualShapeData): SnapedData[] {
        let intersections = (s1.shape as IEdge).intersect(s2.shape as IEdge);
        return intersections.map((point) => {
            return {
                view,
                point,
                info: i18n["snap.intersection"],
                shapes: [s1, s2],
            };
        });
    }

    private getFeaturePoints(view: IView, shape: VisualShapeData) {
        if (this._featureInfos.has(shape)) {
            return this._featureInfos.get(shape)!;
        }
        let infos = new Array<SnapedData>();
        if (shape.shape.shapeType === ShapeType.Edge) {
            this.getEdgeFeaturePoints(view, shape, infos);
        }
        this._featureInfos.set(shape, infos);
        return infos;
    }

    private getEdgeFeaturePoints(view: IView, shape: VisualShapeData, infos: SnapedData[]) {
        let curve = (shape.shape as IEdge).asCurve().value;
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
