// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, VisualConfig } from "../../config";
import type { IDocument } from "../../document";
import { Precision } from "../../foundation";
import { I18n, type I18nKeys } from "../../i18n";
import { Line, type Ray, type XYZ } from "../../math";
import {
    CurveUtils,
    type ICircle,
    type IEdge,
    type IFace,
    type IVertex,
    MeshDataUtils,
    ShapeTypes,
} from "../../shape";
import { type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "../../snapType";
import { type IView, type IVisualContext, screenDistance, type VisualShapeData } from "../../visual";
import type { MouseAndDetected, SnapResult, SnapType } from "../snap";
import { BaseSnap } from "./baseSnap";

interface InvisibleSnapInfo {
    view: IView;
    snaps: SnapResult[];
    displays: number[];
}

export class ObjectSnap extends BaseSnap {
    private readonly _intersectionInfos: Map<string, SnapResult[]> = new Map();
    private readonly _invisibleInfos: Map<VisualShapeData, InvisibleSnapInfo> = new Map();
    private _lastDetected?: [IView, SnapResult];
    private _hintVertex?: [IVisualContext, number];

    constructor(
        private _snapType: ObjectSnapType,
        referencePoint?: () => XYZ,
    ) {
        super(referencePoint);
        Config.instance.onPropertyChanged(this.onSnapTypeChanged);
    }

    override clear() {
        super.clear();
        this._invisibleInfos.forEach((info) => {
            info.displays.forEach((x) => info.view.document.visual.context.removeMesh(x));
        });
        this.removeHint();
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

        const shapes = this.visibleOnly(data);
        let snap: SnapResult | undefined;
        if (
            shapes.some(
                (x) => x.shape.shapeType === ShapeTypes.edge || x.shape.shapeType === ShapeTypes.vertex,
            )
        ) {
            this.showInvisibleSnaps(data.view, shapes[0]);
            snap = this.snapOnShape(data.view, data.mx, data.my, shapes);
        } else {
            snap = this.snapeInvisible(data.view, data.mx, data.my);
        }
        if (this.referencePoint && snap?.point) {
            snap.distance = this.referencePoint().distanceTo(snap.point);
        }
        return snap;
    }

    /**
     * Shaded picking sees through the model: the raycast reports edges and vertices behind the
     * face under the cursor, and their feature points snap as if they were visible. Keep what
     * the visible surface shows — shapes floating in front of it, and shapes lying on it. A
     * wireframe view detects no faces, so nothing is filtered there.
     */
    private visibleOnly(data: MouseAndDetected): VisualShapeData[] {
        const face = data.shapes.find((x) => x.shape.shapeType === ShapeTypes.face);
        if (face?.point === undefined) return data.shapes;

        const ray = data.view.rayAt(data.mx, data.my);
        const faceDepth = face.point.sub(ray.point).dot(ray.direction);
        return data.shapes.filter((x) => {
            if (x.shape.shapeType === ShapeTypes.face) return true;
            if (x.point === undefined) return false;
            const depth = x.point.sub(ray.point).dot(ray.direction);
            return depth <= faceDepth + Precision.OnSurface || this.onVisibleSideOfFace(face, x.point, ray);
        });
    }

    /**
     * Whether a point behind the visible face still lies on its visible side: the parallel ray
     * through the point meets the face no nearer to the camera than the point itself. A
     * distance-to-surface test cannot answer this — the basis surface is unbounded, so the far
     * edge of a cylinder measures distance 0 to the surface of the face hiding it.
     */
    private onVisibleSideOfFace(face: VisualShapeData, point: XYZ, ray: Ray): boolean {
        const invert = face.transform.invert()!;
        const hit = (face.shape as IFace).intersectLine(
            invert.ofPoint(point),
            invert.ofVector(ray.direction),
            Precision.OnSurface,
        );
        if (hit === undefined) return false;

        const depth = point.sub(ray.point).dot(ray.direction);
        const hitDepth = face.transform.ofPoint(hit).sub(ray.point).dot(ray.direction);
        return depth <= hitDepth + Precision.OnSurface;
    }

    private snapOnShape(view: IView, x: number, y: number, shapes: VisualShapeData[]) {
        // A vertex lying nearer along the ray than the edge it sits on must not shadow the
        // edge: feature points are collected from the shapes that have them, but the
        // edge-only queries (perpendicular, edge intersections, nearest-on-curve) run on
        // the first EDGE. Before, a vertex in `shapes[0]` silently disabled all three.
        const edge = shapes.find((s) => s.shape.shapeType === ShapeTypes.edge);
        const featureSources = edge !== undefined && edge !== shapes[0] ? [shapes[0], edge] : [shapes[0]];
        const featurePoints = featureSources.flatMap((s) => this.getFeaturePoints(view, s));
        const perpendiculars = edge !== undefined ? this.findPerpendicular(view, edge) : [];
        const intersections = edge !== undefined ? this.getIntersections(view, edge, shapes) : [];
        const ordered = [...featurePoints, ...perpendiculars, ...intersections].sort((a, b) =>
            this.sortSnaps(view, x, y, a, b),
        );

        if (ordered.length === 0) {
            return undefined;
        }

        if (screenDistance(view, x, y, ordered[0].point!) < Config.instance.SnapDistance) {
            this.highlight(ordered[0].shapes);
            return ordered[0];
        }

        const nearest =
            edge !== undefined ? this.findNearestPointAtEdgeCurve(view, edge, view.rayAt(x, y)) : undefined;
        if (nearest && screenDistance(view, x, y, nearest.point!) < Config.instance.SnapDistance) {
            this.highlight(nearest.shapes);
            return nearest;
        }

        this._lastDetected = [view, ordered[0]];
        return undefined;
    }

    private getFeaturePoints(view: IView, shape: VisualShapeData): SnapResult[] {
        const points: SnapResult[] = [];
        if (shape.shape.shapeType === ShapeTypes.vertex) {
            this.collectVertexFeaturePoints(view, shape, points);
        } else if (shape.shape.shapeType === ShapeTypes.edge) {
            this.collectEdgeFeaturePoints(view, shape, points);
        }
        return points;
    }

    private collectVertexFeaturePoints(view: IView, shape: VisualShapeData, infos: SnapResult[]) {
        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.vertex)) {
            const point = shape.transform.ofPoint((shape.shape as IVertex).point());
            infos.push({
                view,
                point,
                info: I18n.translate("vertex.point"),
                shapes: [shape],
                type: "vertex",
            });
        }
    }

    private collectEdgeFeaturePoints(view: IView, shape: VisualShapeData, infos: SnapResult[]) {
        const curve = (shape.shape as IEdge).curve;
        const start = curve.startPoint();
        const end = curve.endPoint();

        const addPoint = (point: XYZ, info: I18nKeys, type: SnapType) =>
            infos.push({
                view,
                point: shape.transform.ofPoint(point),
                type,
                info: I18n.translate(info),
                shapes: [shape],
            });

        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.endPoint)) {
            addPoint(start, "snap.end", "end");
            addPoint(end, "snap.end", "end");
        }
        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.midPoint)) {
            const mid = curve.value((curve.firstParameter() + curve.lastParameter()) * 0.5);
            addPoint(mid, "snap.mid", "middle");
        }
        if (this.referencePoint && ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.tangent)) {
            if (CurveUtils.isCircle(curve.basisCurve)) {
                const refInLocal = shape.transform.invert()!.ofPoint(this.referencePoint());
                CurveUtils.tangentPoints(curve.basisCurve, refInLocal).forEach((tangent) => {
                    addPoint(tangent, "snap.tangent", "tangent");
                });
            }
        }
    }

    private displayHint(view: IView, shape: SnapResult) {
        this.highlight(shape.shapes);
        const data = MeshDataUtils.createVertexMesh(
            shape.point!,
            VisualConfig.hintVertexSize,
            VisualConfig.hintVertexColor,
        );
        this._hintVertex = [view.document.visual.context, view.document.visual.context.displayMesh([data])];
    }

    private snapeInvisible(view: IView, x: number, y: number): SnapResult | undefined {
        const { minDistance, snap } = this.getNearestInvisibleSnap(view, x, y);
        if (minDistance < Config.instance.SnapDistance) {
            this.highlight(snap!.shapes);
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
                const dist = screenDistance(view, x, y, s.point!);
                if (dist < minDistance) {
                    minDistance = dist;
                    snap = s;
                }
            });
        });
        return { minDistance, snap };
    }

    private showInvisibleSnaps(view: IView, shape: VisualShapeData) {
        if (shape.shape.shapeType === ShapeTypes.edge) {
            if (this._invisibleInfos.has(shape)) return;
            const curve = (shape.shape as IEdge).curve;
            const basisCurve = curve.basisCurve;
            if (CurveUtils.isCircle(basisCurve)) {
                this.showCircleCenter(basisCurve, view, shape);
            }
        }
    }

    private showCircleCenter(curve: ICircle, view: IView, shape: VisualShapeData) {
        const center = shape.transform.ofPoint(curve.center);
        const temporary = MeshDataUtils.createVertexMesh(
            center,
            VisualConfig.hintVertexSize,
            VisualConfig.hintVertexColor,
        );
        const id = view.document.visual.context.displayMesh([temporary]);
        this._invisibleInfos.set(shape, {
            view,
            snaps: [
                {
                    view,
                    point: center,
                    info: I18n.translate("snap.center"),
                    shapes: [shape],
                    type: "center",
                },
            ],
            displays: [id],
        });
    }

    private sortSnaps(view: IView, x: number, y: number, a: SnapResult, b: SnapResult): number {
        return screenDistance(view, x, y, a.point!) - screenDistance(view, x, y, b.point!);
    }

    private findPerpendicular(view: IView, shape: VisualShapeData): SnapResult[] {
        const result: SnapResult[] = [];
        if (
            !ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.perpendicular) ||
            this.referencePoint === undefined
        ) {
            return result;
        }

        if (shape.shape.shapeType === ShapeTypes.edge) {
            const curve = (shape.shape as IEdge).curve;
            const transform = shape.transform;
            const point = curve.project(transform.invert()!.ofPoint(this.referencePoint())).at(0);
            if (point === undefined) return result;
            result.push({
                view,
                point: transform.ofPoint(point),
                info: I18n.translate("snap.perpendicular"),
                shapes: [shape],
                type: "perpendicular",
            });
        }

        return result;
    }

    private getIntersections(view: IView, current: VisualShapeData, shapes: VisualShapeData[]) {
        const result: SnapResult[] = [];
        if (
            !ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.intersection) ||
            current.shape.shapeType !== ShapeTypes.edge
        ) {
            return result;
        }
        shapes.forEach((x) => {
            if (x === current || x.shape.shapeType !== ShapeTypes.edge) return;
            const key = this.getIntersectionKey(current, x);
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
        // Cloned nodes share shape ids, so the owner node id must be part of the key —
        // otherwise intersections of a different node pair would hit the wrong cache entry.
        const k1 = `${s1.owner.node.id}:${s1.shape.id}`;
        const k2 = `${s2.owner.node.id}:${s2.shape.id}`;
        return k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;
    }

    private findIntersections(view: IView, s1: VisualShapeData, s2: VisualShapeData): SnapResult[] {
        const e1 = s1.shape.transformedMul(s1.transform) as IEdge;
        const e2 = s2.shape.transformedMul(s2.transform) as IEdge;
        const intersections = e1.intersect(e2);
        e1.dispose();
        e2.dispose();
        return intersections.map((point) => {
            return {
                view,
                point: point.point,
                info: I18n.translate("snap.intersection"),
                shapes: [s1, s2],
                type: "intersection",
            };
        });
    }

    private findNearestPointAtEdgeCurve(
        view: IView,
        shape: VisualShapeData,
        ray: Ray,
    ): SnapResult | undefined {
        if (!ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.onCurve)) {
            return undefined;
        }
        if (shape.shape.shapeType === ShapeTypes.edge) {
            const curve = (shape.shape as IEdge).curve;
            const transform = shape.transform;
            const point = curve.nearestExtrema(
                new Line({
                    point: transform.invert()!.ofPoint(ray.point),
                    direction: transform.invert()!.ofVector(ray.direction),
                }),
            )?.p1;

            if (point === undefined) return undefined;
            return {
                view,
                point: transform.ofPoint(point),
                info: I18n.translate("snap.nearCurve"),
                shapes: [shape],
                type: "nearCurve",
            };
        }

        return undefined;
    }
}
