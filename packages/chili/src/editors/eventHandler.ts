// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CursorType, I18n, IDisposable, IDocument, IEventHandler, IView, VertexRenderData, XYZ } from "chili-core";
import { ShapePreviewer, Snapper } from "../snap";

export interface FeaturePoint {
    point: XYZ;
    preview: ShapePreviewer;
    displayed: number;
    tip: keyof I18n;
    setter: (newPoint: XYZ) => void;
}

export abstract class EditorEventHandler implements IEventHandler, IDisposable {
    private snaped?: FeaturePoint;
    protected abstract points: FeaturePoint[];

    constructor(readonly document: IDocument) {}

    protected showPoint(point: XYZ): number {
        let start = VertexRenderData.from(point, 0xffff00, 5);
        return this.document.visualization.context.temporaryDisplay(start);
    }

    dispose(): void | Promise<void> {
        this.points.forEach((x) => {
            this.document.visualization.context.temporaryRemove(x.displayed);
        });
        this.points.length = 0;
    }
    pointerMove(view: IView, event: PointerEvent): void {
        for (let point of this.points) {
            if (this.distanceToMouse(view, event.offsetX, event.offsetY, point.point) < 4) {
                view.document.viewer.setCursor(CursorType.Drawing);
                this.snaped = point;
                return;
            }
        }
        this.snaped = undefined;
        view.document.viewer.setCursor(CursorType.Default);
    }
    pointerDown(view: IView, event: PointerEvent): void {}
    async pointerUp(view: IView, event: PointerEvent) {
        if (this.snaped === undefined) return;
        let snapper = this.getSnapper(this.snaped);
        let data = await snapper?.snap(this.document, this.snaped.tip);
        if (data?.point === undefined) return;
        this.setNewPoint(this.snaped, data.point);
        view.document.viewer.redraw();
        this.snaped = undefined;
    }

    protected setNewPoint(snaped: FeaturePoint, point: XYZ) {
        this.document.visualization.context.temporaryRemove(snaped.displayed);
        snaped.point = point;
        snaped.displayed = this.showPoint(point);
        snaped.setter(point);
    }

    protected abstract getSnapper(point: FeaturePoint): Snapper | undefined;

    private distanceToMouse(view: IView, x: number, y: number, point: XYZ) {
        let xy = view.worldToScreen(point);
        let dx = xy.x - x;
        let dy = xy.y - y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    mouseWheel(view: IView, event: WheelEvent): void {}
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            view.document.visualization.selection.clearSelected();
        }
    }
    keyUp(view: IView, event: KeyboardEvent): void {}
}
