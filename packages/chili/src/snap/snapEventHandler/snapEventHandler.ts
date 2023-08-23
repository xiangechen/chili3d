// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    AsyncController,
    Config,
    I18n,
    IEventHandler,
    IView,
    MessageType,
    PubSub,
    Result,
    ShapeType,
    VertexMeshData,
    XYZ,
} from "chili-core";

import { ISnapper, MouseAndDetected, SnapPreviewer, SnapValidator, SnapedData } from "../interfaces";

export abstract class SnapEventHandler implements IEventHandler {
    private _tempPoint?: [IView, number];
    private _tempShapes?: [IView, number[]];
    protected _snaped?: SnapedData;

    constructor(
        readonly controller: AsyncController,
        readonly snaps: ISnapper[],
        readonly validator?: SnapValidator,
        readonly preview?: SnapPreviewer
    ) {
        controller.onCancelled((s) => {
            this.cancel();
        });
    }

    get snaped() {
        return this._snaped;
    }

    dispose() {
        this._snaped = undefined;
    }

    private finish() {
        this.controller.success();
        this.clean();
    }

    #cancelled: boolean = false;
    private cancel() {
        if (this.#cancelled) return;
        this.#cancelled = true;
        this.controller.cancel();
        this.clean();
    }

    private clean() {
        this.clearSnapTip();
        this.removeInput();
        this.removeTempShapes();
        this.snaps.forEach((x) => x.clear());
    }

    private removeInput() {
        PubSub.default.pub("clearInput");
    }

    pointerMove(view: IView, event: MouseEvent): void {
        this.removeTempObject(view);
        this.setSnaped(view, event);
        if (this._snaped !== undefined) {
            this.showTempShape(this._snaped.point, view);
            this.switchSnapedTip(this._snaped.info);
        } else {
            this.clearSnapTip();
        }
        view.viewer.redraw();
    }

    private setSnaped(view: IView, event: MouseEvent) {
        this._snaped = this.findSnaped(ShapeType.Edge, view, event);
        this.snaps.forEach((x) => {
            x.handleSnaped?.(view.viewer.visual.document, this._snaped);
        });
    }

    private findSnaped(shapeType: ShapeType, view: IView, event: MouseEvent) {
        let data = this.findDetecteds(shapeType, view, event);
        for (const snap of this.snaps) {
            let snaped = snap.snap(data);
            if (snaped === undefined) continue;
            if (this.validator?.(snaped.point)) {
                return snaped;
            }
        }

        return undefined;
    }

    private findDetecteds(shapeType: ShapeType, view: IView, event: MouseEvent): MouseAndDetected {
        let shapes = view.detected(shapeType, event.offsetX, event.offsetY, false);
        return {
            shapes,
            view,
            mx: event.offsetX,
            my: event.offsetY,
        };
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
        this.removeTempShapes();
        this.snaps.forEach((x) => x.removeDynamicObject());
    }

    private showTempShape(point: XYZ, view: IView) {
        let data = VertexMeshData.from(
            point,
            Config.instance.visual.temporaryVertexSize,
            Config.instance.visual.temporaryVertexColor
        );
        this._tempPoint = [view, view.viewer.visual.context.displayShapeMesh(data)];
        let shapes = this.preview?.(point);
        this._tempShapes = shapes
            ? [
                  view,
                  shapes.map((shape) => {
                      return view.viewer.visual.context.displayShapeMesh(shape);
                  }),
              ]
            : undefined;
    }

    private removeTempShapes() {
        let view = this._tempPoint?.[0] ?? this._tempShapes?.[0];
        if (this._tempPoint) {
            this._tempPoint[0].viewer.visual.context.removeShapeMesh(this._tempPoint[1]);
            this._tempPoint = undefined;
        }
        this._tempShapes?.[1].forEach((x) => {
            this._tempShapes?.[0].viewer.visual.context.removeShapeMesh(x);
        });
        view?.viewer.redraw();
        this._tempShapes = undefined;
    }

    pointerDown(view: IView, event: MouseEvent): void {
        if (event.button === 0) {
            this.finish();
        }
    }
    pointerUp(view: IView, event: MouseEvent): void {}
    mouseWheel(view: IView, event: WheelEvent): void {
        view.viewer.redraw();
    }
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this._snaped = undefined;
            this.cancel();
        } else if (["-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)) {
            PubSub.default.pub("showInput", (text: string) => {
                let error = this.inputError(text);
                if (error === undefined) {
                    this.handleText(view, text);
                    return Result.success(text);
                } else {
                    return Result.error(error);
                }
            });
        }
    }

    private handleText = (view: IView, text: string) => {
        this._snaped = {
            view,
            point: this.getPointFromInput(view, text),
            shapes: [],
        };
        this.finish();
    };

    protected abstract getPointFromInput(view: IView, text: string): XYZ;

    protected abstract inputError(text: string): keyof I18n | undefined;
}
