// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CursorType, I18n, IDisposable, IDocument, IEventHandler, IView, VertexRenderData, XYZ } from "chili-core";
import { Dimension, PointSnapper, ShapePreviewer } from "../snap";

export interface FeaturePoint {
    point: XYZ;
    preview: ShapePreviewer;
    tip: keyof I18n;
    setter: (newPoint: XYZ) => void;
}

export abstract class EditorEventHandler implements IEventHandler, IDisposable {
    private snapedIndex?: number;
    protected points: FeaturePoint[] = [];
    protected shapes: number[] = [];

    constructor(readonly document: IDocument) {}

    showEditorPoints() {
        for (const x of this.featurePoints()) {
            this.points.push(x);
            this.shapes.push(this.showPoint(x.point));
        }
    }

    abstract featurePoints(): FeaturePoint[];

    private showPoint(point: XYZ): number {
        let start = VertexRenderData.from(point, 0xffff00, 5);
        return this.document.visualization.context.temporaryDisplay(start);
    }

    dispose(): void | Promise<void> {
        this.shapes.forEach((x) => {
            this.document.visualization.context.temporaryRemove(x);
        });
        this.shapes.length = 0;
        this.points.length = 0;
    }
    pointerMove(view: IView, event: PointerEvent): void {
        for (let i = 0; i < this.points.length; i++) {
            const point = this.points[i];
            if (this.distanceToMouse(view, event.offsetX, event.offsetY, point.point) < 4) {
                view.document.viewer.setCursor(CursorType.Drawing);
                this.snapedIndex = i;
                return;
            }
        }
        this.snapedIndex = undefined;
        view.document.viewer.setCursor(CursorType.Default);
    }
    pointerDown(view: IView, event: PointerEvent): void {}
    async pointerUp(view: IView, event: PointerEvent) {
        if (this.snapedIndex === undefined) return;
        let snapper = new PointSnapper({
            dimension: Dimension.D1D2D3,
            refPoint: this.points[this.snapedIndex].point,
            preview: this.points[this.snapedIndex].preview,
        });
        let data = await snapper.snap(this.document, this.points[this.snapedIndex].tip);
        if (data?.point === undefined) return;
        this.points[this.snapedIndex].point = data.point;
        this.points[this.snapedIndex].setter(data.point);
        this.document.visualization.context.temporaryRemove(this.shapes[this.snapedIndex]);
        this.shapes[this.snapedIndex] = this.showPoint(data.point);
        view.document.viewer.redraw();
        this.snapedIndex = undefined;
    }

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
