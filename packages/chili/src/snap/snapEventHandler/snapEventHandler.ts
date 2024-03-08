// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    Config,
    I18nKeys,
    IDocument,
    IEventHandler,
    IShapeFilter,
    IView,
    MessageType,
    PubSub,
    Result,
    ShapeType,
    VertexMeshData,
    XYZ,
} from "chili-core";

import { ISnapper, MouseAndDetected, SnapValidator, SnapedData } from "../interfaces";
import { SnapPointData } from "./snapPointEventHandler";

export abstract class SnapEventHandler implements IEventHandler {
    private _tempPoint?: number;
    private _tempShapes?: number[];
    protected _snaped?: SnapedData;
    private validators: SnapValidator[] = [];

    constructor(
        readonly document: IDocument,
        readonly controller: AsyncController,
        readonly snaps: ISnapper[],
        readonly data: SnapPointData,
        readonly filter?: IShapeFilter,
    ) {
        if (data.validators) {
            this.validators.push(...data.validators);
        }
        this.showTempShape(undefined);
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

    private _cancelled: boolean = false;
    private cancel() {
        if (this._cancelled) return;
        this._cancelled = true;
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
        this.removeTempObject();
        this.setSnaped(view, event);
        if (this._snaped !== undefined) {
            this.switchSnapedPrompt(this.data.prompt?.(this._snaped) ?? this.snaped?.info);
        } else {
            this.clearSnapTip();
        }
        this.showTempShape(this._snaped?.point);
        view.viewer.update();
    }

    private setSnaped(view: IView, event: MouseEvent) {
        if (!this.snapToFeaturePoint(view, event)) {
            this._snaped = this.findSnaped(ShapeType.Edge, view, event);
            this.snaps.forEach((x) => {
                x.handleSnaped?.(view.viewer.visual.document, this._snaped);
            });
        }
    }

    private snapToFeaturePoint(view: IView, event: MouseEvent) {
        let minDist = Number.MAX_VALUE;
        let snapFeaturePoint: { point: XYZ; prompt: string } | undefined = undefined;
        this.data.featurePoints?.forEach((x) => {
            if (x.when !== undefined && !x.when()) {
                return;
            }
            let dist = IView.screenDistance(view, event.offsetX, event.offsetY, x.point);
            if (dist < minDist) {
                minDist = dist;
                snapFeaturePoint = x;
            }
        });
        if (minDist < Config.instance.SnapDistance) {
            this._snaped = {
                view,
                point: snapFeaturePoint!.point,
                info: snapFeaturePoint!.prompt,
                shapes: [],
            };
            return true;
        }
        return false;
    }

    private findSnaped(shapeType: ShapeType, view: IView, event: MouseEvent) {
        let data = this.findDetecteds(shapeType, view, event);
        for (const snap of this.snaps) {
            let snaped = snap.snap(data);
            if (snaped === undefined) continue;
            if (this.validateSnaped(snaped)) return snaped;
        }

        return undefined;
    }

    private validateSnaped(snaped: SnapedData) {
        for (const validator of this.validators) {
            if (!validator(snaped.point!)) {
                return false;
            }
        }
        return true;
    }

    private findDetecteds(shapeType: ShapeType, view: IView, event: MouseEvent): MouseAndDetected {
        let shapes = view.detected(shapeType, event.offsetX, event.offsetY, this.filter);
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

    private switchSnapedPrompt(msg: string | undefined) {
        if (msg === undefined) {
            this.clearSnapTip();
            return;
        }
        PubSub.default.pub("showFloatTip", MessageType.info, msg);
    }

    private removeTempObject() {
        this.removeTempShapes();
        this.snaps.forEach((x) => x.removeDynamicObject());
    }

    private showTempShape(point: XYZ | undefined) {
        if (point) {
            let data = VertexMeshData.from(
                point,
                Config.instance.visual.temporaryVertexSize,
                Config.instance.visual.temporaryVertexColor,
            );
            this._tempPoint = this.document.visual.context.displayShapeMesh(data);
        }
        this._tempShapes = this.data.preview?.(point)?.map((shape) => {
            return this.document.visual.context.displayShapeMesh(shape);
        });
    }

    private removeTempShapes() {
        if (this._tempPoint) {
            this.document.visual.context.removeShapeMesh(this._tempPoint);
            this._tempPoint = undefined;
        }
        this._tempShapes?.forEach((x) => {
            this.document.visual.context.removeShapeMesh(x);
        });
        this.document.visual.viewer.update();
        this._tempShapes = undefined;
    }

    pointerDown(view: IView, event: MouseEvent): void {
        if (event.button === 0) {
            this.finish();
        }
    }
    pointerUp(view: IView, event: MouseEvent): void {}
    mouseWheel(view: IView, event: WheelEvent): void {
        view.viewer.update();
    }
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this._snaped = undefined;
            this.cancel();
        } else if (["-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)) {
            PubSub.default.pub("showInput", event.key, (text: string) => {
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

    protected abstract inputError(text: string): I18nKeys | undefined;
}
