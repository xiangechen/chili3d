// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Config,
    I18n,
    ICircle,
    ICurve,
    IDocument,
    IEdge,
    IView,
    IVisualContext,
    ObjectSnapType,
    ShapeType,
    VertexMeshData,
    VisualConfig,
    VisualShapeData,
    XYZ,
} from "chili-core";
import { MouseAndDetected, SnapResult } from "../snap";
import { BaseSnap } from "./baseSnap";
import { FeaturePointStrategy } from "./featurePointStrategy";

interface InvisibleSnapInfo {
    view: IView;
    snaps: SnapResult[];
    displays: number[];
}

export class ObjectSnap extends BaseSnap {
    private readonly _featureStrategy: FeaturePointStrategy;
    private readonly _intersectionInfos: Map<string, SnapResult[]>;
    private readonly _invisibleInfos: Map<VisualShapeData, InvisibleSnapInfo>;
    private _lastDetected?: [IView, SnapResult];
    private _hintVertex?: [IVisualContext, number];

    constructor(
        private _snapType: ObjectSnapType,
        referencePoint?: () => XYZ,
    ) {
        super(referencePoint);
        this._featureStrategy = new FeaturePointStrategy(_snapType);
        this._intersectionInfos = new Map();
        this._invisibleInfos = new Map();
        Config.instance.onPropertyChanged(this.onSnapTypeChanged);
    }

    override clear() {
        super.clear();
        this._invisibleInfos.forEach((info) => {
            info.displays.forEach((x) => info.view.document.visual.context.removeMesh(x));
        });
        this.removeHint();
        this._featureStrategy.clear();
        Config.instance.removePropertyChanged(this.onSnapTypeChanged);
    }

    readonly handleSnaped = (document: IDocument, snaped?: SnapResult | undefined) => {
        if (snaped?.shapes.length === 0 && this._lastDetected) {
            this.displayHint(this._lastDetected[0], this._lastDetected[1]);
            this._lastDetected = undefined;
        }
    };

    private readonly onSnapTypeChanged = (property: keyof Config) => {
        if (property === "snapType" || property === "enableSnap") {
            this._snapType = Config.instance.snapType;
            this._featureStrategy.updateSnapType(this._snapType);
            this._intersectionInfos.clear();
        }
    };

    override removeDynamicObject(): void {
        super.removeDynamicObject();
        this.removeHint();
    }

    private removeHint() {
        if (this._hintVertex !== undefined) {
            this._hintVertex[0].removeMesh(this._hintVertex[1]);
            this._hintVertex = undefined;
        }
    }

    snap(data: MouseAndDetected): SnapResult | undefined {
        if (!Config.instance.enableSnap) return undefined;

        let snap: SnapResult | undefined;
        if (data.shapes.length > 0) {
            this.showInvisibleSnaps(data.view, data.shapes[0]);
            snap = this.snapOnShape(data.view, data.mx, data.my, data.shapes);
        } else {
            snap = this.snapeInvisible(data.view, data.mx, data.my);
        }
        if (this.referencePoint && snap?.point) {
            snap.distance = this.referencePoint().distanceTo(snap.point);
        }
        return snap;
    }

    private snapOnShape(view: IView, x: number, y: number, shapes: VisualShapeData[]) {
        const featurePoints = this._featureStrategy.getFeaturePoints(view, shapes[0]);
        const perpendiculars = this.findPerpendicular(view, shapes[0]);
        const intersections = this.getIntersections(view, shapes[0], shapes);
        const ordered = [...featurePoints, ...perpendiculars, ...intersections].sort((a, b) =>
            this.sortSnaps(view, x, y, a, b),
        );

        if (ordered.length === 0) return undefined;

        const dist = IView.screenDistance(view, x, y, ordered[0].point!);
        if (dist < Config.instance.SnapDistance) {
            this.hilighted(view, ordered[0].shapes);
            return ordered[0];
        } else {
            this._lastDetected = [view, ordered[0]];
            return undefined;
        }
    }

    private displayHint(view: IView, shape: SnapResult) {
        this.hilighted(view, shape.shapes);
        let data = VertexMeshData.from(
            shape.point!,
            VisualConfig.hintVertexSize,
            VisualConfig.hintVertexColor,
        );
        this._hintVertex = [view.document.visual.context, view.document.visual.context.displayMesh([data])];
    }

    private snapeInvisible(view: IView, x: number, y: number): SnapResult | undefined {
        const { minDistance, snap } = this.getNearestInvisibleSnap(view, x, y);
        if (minDistance < Config.instance.SnapDistance) {
            this.hilighted(view, snap!.shapes);
            return snap;
        }
        return undefined;
    }

    private getNearestInvisibleSnap(
        view: IView,
        x: number,
        y: number,
    ): { minDistance: number; snap?: SnapResult } {
        let snap: SnapResult | undefined;
        let minDistance = Number.MAX_VALUE;

        this._invisibleInfos.forEach((info) => {
            info.snaps.forEach((s) => {
                const dist = IView.screenDistance(view, x, y, s.point!);
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
            let curve = (shape.shape as IEdge).curve;
            let basisCurve = curve.basisCurve;
            if (ICurve.isCircle(basisCurve)) {
                this.showCircleCenter(basisCurve, view, shape);
            }
        }
    }

    private showCircleCenter(curve: ICircle, view: IView, shape: VisualShapeData) {
        const center = shape.transform.ofPoint(curve.center);
        let temporary = VertexMeshData.from(
            center,
            VisualConfig.hintVertexSize,
            VisualConfig.hintVertexColor,
        );
        let id = view.document.visual.context.displayMesh([temporary]);
        this._invisibleInfos.set(shape, {
            view,
            snaps: [
                {
                    view,
                    point: center,
                    info: I18n.translate("snap.center"),
                    shapes: [shape],
                },
            ],
            displays: [id],
        });
    }

    private hilighted(view: IView, shapes: VisualShapeData[]) {
        this.highlight(shapes);
    }

    private sortSnaps(view: IView, x: number, y: number, a: SnapResult, b: SnapResult): number {
        return IView.screenDistance(view, x, y, a.point!) - IView.screenDistance(view, x, y, b.point!);
    }

    private findPerpendicular(view: IView, shape: VisualShapeData): SnapResult[] {
        let result: SnapResult[] = [];
        if (
            !ObjectSnapType.has(this._snapType, ObjectSnapType.perpendicular) ||
            this.referencePoint === undefined
        ) {
            return result;
        }

        let curve = (shape.shape as IEdge).curve;
        const transform = shape.transform;
        let point = curve.project(transform.invert()!.ofPoint(this.referencePoint())).at(0);
        if (point === undefined) return result;
        result.push({
            view,
            point: transform.ofPoint(point),
            info: I18n.translate("snap.perpendicular"),
            shapes: [shape],
        });

        return result;
    }

    private getIntersections(view: IView, current: VisualShapeData, shapes: VisualShapeData[]) {
        let result = new Array<SnapResult>();
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

    private findIntersections(view: IView, s1: VisualShapeData, s2: VisualShapeData): SnapResult[] {
        const e1 = s1.shape.transformedMul(s1.transform) as IEdge;
        const e2 = s2.shape.transformedMul(s2.transform) as IEdge;
        let intersections = e1.intersect(e2);
        e1.dispose();
        e2.dispose();
        return intersections.map((point) => {
            return {
                view,
                point: point.point,
                info: I18n.translate("snap.intersection"),
                shapes: [s1, s2],
            };
        });
    }
}
