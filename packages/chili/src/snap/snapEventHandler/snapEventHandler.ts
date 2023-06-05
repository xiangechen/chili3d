// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    TaskToken,
    Color,
    IEventHandler,
    IShape,
    IView,
    MessageType,
    ObjectSnapType,
    PubSub,
    ShapeType,
    Validation,
    VertexMeshData,
    XYZ,
    I18n,
    Result,
} from "chili-core";

import { ISnapper, MouseAndDetected, SnapChangedHandler, SnapedData } from "../interfaces";
import { ShapePreviewer, Validator } from "./interfaces";

export interface SnapEventData {
    snaps: ISnapper[];
    snapChangedHandlers?: SnapChangedHandler[];
    validator?: Validator;
    preview?: ShapePreviewer;
}

export abstract class SnapEventHandler implements IEventHandler {
    private _tempPointId?: number;
    private _tempShapeId?: number;
    protected _snaped?: SnapedData;
    private readonly _snaps: ISnapper[];
    private readonly _snapeChangedHandlers: SnapChangedHandler[];

    constructor(readonly token: TaskToken, private readonly data: SnapEventData) {
        this._snaps = [...data.snaps];
        this._snapeChangedHandlers =
            data.snapChangedHandlers === undefined ? [] : [...data.snapChangedHandlers];
        PubSub.default.sub("snapChanged", this.onSnapChanged);
    }

    private onSnapChanged = (snapType: ObjectSnapType) => {
        this._snaps.forEach((x) => x.onSnapTypeChanged(snapType));
    };

    get snaped() {
        return this._snaped;
    }

    private finish(view: IView) {
        this.token.complete();
        this.clean(view);
    }

    private cancel(view: IView) {
        this.token.cancel();
        this.clean(view);
    }

    private clean(view: IView) {
        this._snapeChangedHandlers.length = 0;
        this.clearSnapTip();
        this.removeInput();
        this.removeTempShapes(view);
        this._snaps.forEach((x) => x.clear());
        view.viewer.redraw();
    }

    private removeInput() {
        PubSub.default.pub("clearInput");
    }

    pointerMove(view: IView, event: MouseEvent): void {
        this.removeTempObject(view);
        this._snaped = this.getSnaped(ShapeType.Edge, view, event);
        this._snapeChangedHandlers.forEach((x) => x.onSnapChanged(view, this._snaped));
        if (this._snaped !== undefined) {
            this.showTempShape(this._snaped.point, view);
            this.switchSnapedTip(this._snaped.info);
        } else {
            this.clearSnapTip();
        }
        view.viewer.redraw();
    }

    private getSnaped(shapeType: ShapeType, view: IView, event: MouseEvent) {
        let data = this.getDetectedData(shapeType, view, event);
        for (const snap of this._snaps) {
            let snaped = snap.snap(data);
            if (snaped === undefined) continue;
            if (this.data.validator?.(snaped.point)) {
                return snaped;
            }
        }

        return undefined;
    }

    private getDetectedData(shapeType: ShapeType, view: IView, event: MouseEvent): MouseAndDetected {
        let shapes = view
            .detected(shapeType, event.offsetX, event.offsetY, false)
            .map((x) => x.shape)
            .filter((x) => x !== undefined) as IShape[];
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
        this.removeTempShapes(view);
        this._snaps.forEach((x) => x.removeDynamicObject());
    }

    private showTempShape(point: XYZ, view: IView) {
        let data = VertexMeshData.from(point, 3, Color.fromHex(0xff0000));
        this._tempPointId = view.viewer.visual.context.temporaryDisplay(data);
        let shape = this.data.preview?.(point);
        if (shape !== undefined) {
            let edges = shape.mesh().edges;
            if (edges !== undefined) this._tempShapeId = view.viewer.visual.context.temporaryDisplay(edges);
        }
    }

    private removeTempShapes(view: IView) {
        if (this._tempPointId !== undefined) {
            view.viewer.visual.context.temporaryRemove(this._tempPointId);
            this._tempPointId = undefined;
        }
        if (this._tempShapeId !== undefined) {
            view.viewer.visual.context.temporaryRemove(this._tempShapeId);
            this._tempShapeId = undefined;
        }
    }

    pointerDown(view: IView, event: MouseEvent): void {
        if (event.button === 0) {
            this.finish(view);
        }
    }
    pointerUp(view: IView, event: MouseEvent): void {}
    mouseWheel(view: IView, event: WheelEvent): void {
        view.viewer.redraw();
    }
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this._snaped = undefined;
            this.cancel(view);
        } else if (["-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)) {
            PubSub.default.pub("showInput", {
                execute: (text: string) => {
                    let valid = this.isTextValid(text);
                    if (valid.isOk) {
                        this.handleText(view, text);
                        return Result.ok(undefined);
                    } else {
                        return Result.error(valid.error!);
                    }
                },
            });
        }
    }

    private handleText = (view: IView, text: string) => {
        this._snaped = {
            view,
            point: this.getPointFromInput(view, text),
            shapes: [],
        };
        this.finish(view);
    };

    protected abstract getPointFromInput(view: IView, text: string): XYZ;

    protected abstract isTextValid(text: string): Validation<keyof I18n>;

    keyUp(view: IView, event: KeyboardEvent): void {}
}
