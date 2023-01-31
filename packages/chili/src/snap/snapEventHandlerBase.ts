// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    CancellationToken,
    IEventHandler,
    IView,
    MessageType,
    ObjectSnapType,
    PubSub,
    ShapeType,
    Validation,
    VertexRenderData,
    XYZ,
} from "chili-core";

import { MouseAndDetected, ISnap, SnapChangedHandler, SnapedData } from "./interfaces";

export abstract class SnapEventHandlerBase implements IEventHandler {
    private _tempPointId?: number;
    private _tempShapeId?: number;
    protected _snaped?: SnapedData;
    private _snaps: ISnap[];
    private _snapedChangedHandlers: SnapChangedHandler[];

    constructor(
        private _cancellationToken: CancellationToken,
        snaps: ISnap[],
        snapedChangedHandlers: SnapChangedHandler[]
    ) {
        this._snaps = [...snaps];
        this._snapedChangedHandlers = [...snapedChangedHandlers];
        PubSub.default.sub("snapChanged", this.onSnapChanged);
    }

    private onSnapChanged = (snapType: ObjectSnapType) => {
        this._snaps.forEach((x) => x.onSnapTypeChanged(snapType));
    };

    get snapedPoint() {
        return this._snaped?.point;
    }

    private stopSnap(view: IView) {
        this._snapedChangedHandlers.length = 0;
        this._cancellationToken.cancel();
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

    mouseMove(view: IView, event: MouseEvent): void {
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
            if (this.isValid(view, snaped)) {
                return snaped;
            }
        }

        return undefined;
    }

    protected abstract isValid(view: IView, snaped: SnapedData): boolean;

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
        this._tempShapeId = this.createTempShape(view, point);
    }

    protected abstract createTempShape(view: IView, point: XYZ): number | undefined;

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

    mouseDown(view: IView, event: MouseEvent): void {
        if (event.button === 0) {
            this.stopSnap(view);
        }
    }
    mouseUp(view: IView, event: MouseEvent): void {}
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
                (t) => this.handleValid(t),
                (text: string) => this.handleInput(view, text)
            );
        }
    }

    private handleInput = (view: IView, text: string) => {
        this._snaped = {
            point: this.getInput(view, text),
            shapes: [],
        };
        this.stopSnap(view);
    };

    protected abstract getInput(view: IView, text: string): XYZ;

    protected abstract handleValid(text: string): Validation;

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
