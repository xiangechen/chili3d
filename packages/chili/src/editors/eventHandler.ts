// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    Config,
    CursorType,
    I18nKeys,
    IDisposable,
    IDocument,
    IEventHandler,
    IView,
    VertexMeshData,
    XYZ,
} from "chili-core";
import { SnapPreviewer, Snapper } from "../snap";

export interface FeaturePoint {
    point: XYZ;
    preview: SnapPreviewer;
    displayed: number;
    tip: I18nKeys;
    setter: (newPoint: XYZ) => void;
}

export abstract class EditorEventHandler implements IEventHandler, IDisposable {
    private snaped?: FeaturePoint;

    private _points?: FeaturePoint[];
    protected get points() {
        if (this._points === undefined) {
            this._points = this.featurePoints();
        }
        return this._points;
    }

    constructor(readonly document: IDocument) {}

    protected abstract featurePoints(): FeaturePoint[];

    protected showPoint(point: XYZ): number {
        let start = VertexMeshData.from(
            point,
            Config.instance.visual.editVertexSize,
            Config.instance.visual.editVertexColor,
        );
        return this.document.visual.context.displayShapeMesh(start);
    }

    dispose() {
        this.points.forEach((x) => {
            this.document.visual.context.removeShapeMesh(x.displayed);
        });
        this.points.length = 0;
    }
    pointerMove(view: IView, event: PointerEvent): void {
        for (let point of this.points) {
            if (IView.screenDistance(view, event.offsetX, event.offsetY, point.point) < 4) {
                view.viewer.setCursor(CursorType.Drawing);
                this.snaped = point;
                return;
            }
        }
        this.snaped = undefined;
        view.viewer.setCursor(CursorType.Default);
    }
    pointerDown(view: IView, event: PointerEvent): void {}
    async pointerUp(view: IView, event: PointerEvent) {
        if (this.snaped === undefined) return;
        let snapper = this.getSnapper(this.snaped);
        let data = await snapper?.snap(this.document, this.snaped.tip, new AsyncController());
        if (data?.point === undefined) return;
        this.setNewPoint(this.snaped, data.point);
        view.viewer.update();
        this.snaped = undefined;
    }

    protected setNewPoint(snaped: FeaturePoint, point: XYZ) {
        this.document.visual.context.removeShapeMesh(snaped.displayed);
        snaped.point = point;
        snaped.displayed = this.showPoint(point);
        snaped.setter(point);
    }

    protected abstract getSnapper(point: FeaturePoint): Snapper | undefined;

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            view.viewer.visual.document.selection.clearSelection();
        }
    }
}
