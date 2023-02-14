// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    CancellationToken,
    IEventHandler,
    IShape,
    IView,
    MessageType,
    ObjectSnapType,
    PubSub,
    ShapeType,
    Validation,
    VertexRenderData,
    XYZ,
} from "chili-core";

import { ISnap, MouseAndDetected, SnapChangedHandler, SnapedData } from "../interfaces";
import { ShapePreviewer, Validator } from "./interfaces";

export interface SnapEventData {
    cancellationToken: CancellationToken;
    snaps: ISnap[];
    snapChangedHandlers?: SnapChangedHandler[];
    validator?: Validator;
    preview?: ShapePreviewer;
}

export abstract class SnapEventHandler implements IEventHandler {
    private _tempPointId?: number;
    private _tempShapeId?: number;
    protected _snaped?: SnapedData;
    private readonly _snaps: ISnap[];
    private readonly _snapedChangedHandlers: SnapChangedHandler[];

    constructor(private readonly data: SnapEventData) {
        this._snaps = [...data.snaps];
        this._snapedChangedHandlers = data.snapChangedHandlers === undefined ? [] : [...data.snapChangedHandlers];
        PubSub.default.sub("snapChanged", this.onSnapChanged);
    }

    private onSnapChanged = (snapType: ObjectSnapType) => {
        this._snaps.forEach((x) => x.onSnapTypeChanged(snapType));
    };

    get snaped() {
        return this._snaped;
    }

    private stopSnap(view: IView) {
        this._snapedChangedHandlers.length = 0;
        this.data.cancellationToken.cancel();
        this.clearSnapTip();
        this.removeInput();
        this.removeTempShapes(view);
        this._snaps.forEach((x) => x.clear());
        view.document.selection.setSelectionType(ShapeType.Shape);
        view.document.viewer.redraw();
    }

    private removeInput() {
        PubSub.default.pub("clearInput");
    }

    pointerMove(view: IView, event: MouseEvent): void {
        this.removeTempObject(view);
        this._snaped = this.getSnaped(view, event);
        this._snapedChangedHandlers.forEach((x) => x.onSnapChanged(view, this._snaped));
        if (this._snaped !== undefined) {
            this.showTempShape(this._snaped.point, view);
            this.switchSnapedTip(this._snaped.info);
        } else {
            this.clearSnapTip();
        }
        view.document.viewer.update();
    }

    private getSnaped(view: IView, event: MouseEvent) {
        let data = this.getDetectedData(view, event);
        for (const snap of this._snaps) {
            let snaped = snap.snap(data);
            if (snaped === undefined) continue;
            if (this.data.validator === undefined || this.data.validator(snaped.point)) {
                return snaped;
            }
        }

        return undefined;
    }

    private getDetectedData(view: IView, event: MouseEvent) {
        view.document.selection.setSelectionType(ShapeType.Edge);
        let shapes = view.document.selection.detectedShapes(view, event.offsetX, event.offsetY);
        let data: MouseAndDetected = {
            view,
            mx: event.offsetX,
            my: event.offsetY,
            shapes,
        };
        return data;
    }

    private clearSnapTip() {
        PubSub.default.pub("clearFloatTip");
    }

    private switchSnapedTip(msg: string | undefined) {
        if (msg === undefined) {
            this.clearSnapTip();
            return;
        }
        PubSub.default.pub("showFloatTip", MessageType.info, msg);
    }

    private removeTempObject(view: IView) {
        this.removeTempShapes(view);
        this._snaps.forEach((x) => x.removeDynamicObject());
    }

    private showTempShape(point: XYZ, view: IView) {
        let data = VertexRenderData.from(point, 0xff0000, 3);
        this._tempPointId = view.document.visualization.context.temporaryDisplay(data);
        let shape = this.data.preview?.(point);
        if (shape !== undefined) {
            let renderDatas = shape.mesh().edges.map((x) => x.renderData);
            this._tempShapeId = view.document.visualization.context.temporaryDisplay(...renderDatas);
        }
    }

    private removeTempShapes(view: IView) {
        if (this._tempPointId !== undefined) {
            view.document.visualization.context.temporaryRemove(this._tempPointId);
            this._tempPointId = undefined;
        }
        if (this._tempShapeId !== undefined) {
            view.document.visualization.context.temporaryRemove(this._tempShapeId);
            this._tempShapeId = undefined;
        }
    }

    pointerDown(view: IView, event: MouseEvent): void {
        if (event.button === 0) {
            this.stopSnap(view);
        }
    }
    pointerUp(view: IView, event: MouseEvent): void {}
    mouseOut(view: IView, event: MouseEvent): void {}
    mouseWheel(view: IView, event: WheelEvent): void {
        view.document.viewer.update();
    }
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this._snaped = undefined;
            this.stopSnap(view);
        } else if (event.key in ["-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
            PubSub.default.pub(
                "showInput",
                (t) => this.isValidInput(t),
                (text: string) => this.handleInput(view, text)
            );
        }
    }

    private handleInput = (view: IView, text: string) => {
        this._snaped = {
            view,
            point: this.getPointFromInput(view, text),
            shapes: [],
        };
        this.stopSnap(view);
    };

    protected abstract getPointFromInput(view: IView, text: string): XYZ;

    protected abstract isValidInput(text: string): Validation;

    keyUp(view: IView, event: KeyboardEvent): void {}
    touchStart(view: IView, event: TouchEvent): void {
        throw new Error("Method not implemented.");
    }
    touchMove(view: IView, event: TouchEvent): void {
        throw new Error("Method not implemented.");
    }
    touchEnd(view: IView, event: TouchEvent): void {
        throw new Error("Method not implemented.");
    }
}
