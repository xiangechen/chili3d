// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    AsyncToken,
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

import { ISnapper, MouseAndDetected, ShapePreviewer, SnapedData, Validator } from "../interfaces";

export abstract class SnapEventHandler implements IEventHandler {
    private _tempPointId?: number;
    private _tempShapeId?: number;
    protected _snaped?: SnapedData;

    constructor(
        readonly token: AsyncToken,
        readonly snaps: ISnapper[],
        readonly validator?: Validator,
        readonly preview?: ShapePreviewer
    ) {}

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
        this.clearSnapTip();
        this.removeInput();
        this.removeTempShapes(view);
        this.snaps.forEach((x) => x.clear());
        view.viewer.redraw();
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
        this.removeTempShapes(view);
        this.snaps.forEach((x) => x.removeDynamicObject());
    }

    private showTempShape(point: XYZ, view: IView) {
        let data = VertexMeshData.from(
            point,
            Config.instance.visual.temporaryVertexSize,
            Config.instance.visual.temporaryVertexColor
        );
        this._tempPointId = view.viewer.visual.context.displayShapeMesh(data);
        let shape = this.preview?.(point);
        if (shape !== undefined) {
            let edges = shape.mesh().edges;
            if (edges !== undefined) this._tempShapeId = view.viewer.visual.context.displayShapeMesh(edges);
        }
    }

    private removeTempShapes(view: IView) {
        if (this._tempPointId !== undefined) {
            view.viewer.visual.context.removeShapeMesh(this._tempPointId);
            this._tempPointId = undefined;
        }
        if (this._tempShapeId !== undefined) {
            view.viewer.visual.context.removeShapeMesh(this._tempShapeId);
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
            PubSub.default.pub("showInput", (text: string) => {
                let error = this.getErrorMessage(text);
                if (error === undefined) {
                    this.handleText(view, text);
                    return Result.ok(undefined);
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
        this.finish(view);
    };

    protected abstract getPointFromInput(view: IView, text: string): XYZ;

    protected abstract getErrorMessage(text: string): keyof I18n | undefined;

    keyUp(view: IView, event: KeyboardEvent): void {}
}
