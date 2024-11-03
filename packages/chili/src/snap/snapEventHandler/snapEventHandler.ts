// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    Config,
    I18nKeys,
    IDocument,
    IEventHandler,
    IView,
    MessageType,
    PubSub,
    Result,
    ShapeType,
    VertexMeshData,
    VisualConfig,
    XYZ,
} from "chili-core";
import { ISnap, MouseAndDetected, SnapData, SnapValidator, SnapedData } from "../snap";

export abstract class SnapEventHandler<D extends SnapData = SnapData> implements IEventHandler {
    private _tempPoint?: number;
    private _tempShapes?: number[];
    protected _snaped?: SnapedData;
    private readonly validators: SnapValidator[] = [];

    constructor(
        readonly document: IDocument,
        readonly controller: AsyncController,
        readonly snaps: ISnap[],
        readonly data: D,
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
            this.switchSnapedPrompt(this.getPrompt(this._snaped));
        } else {
            this.clearSnapTip();
        }
        this.showTempShape(this._snaped?.point);
        view.document.visual.update();
    }

    private getPrompt(snaped: SnapedData) {
        let prompt = this.data.prompt?.(snaped);
        if (!prompt) {
            let distance = snaped.distance ?? snaped.refPoint?.distanceTo(snaped.point!);
            if (distance) {
                prompt = `${distance.toFixed(2)}`;
            }
        }

        return [snaped.info, prompt].filter((x) => x !== undefined).join(" -> ");
    }

    private setSnaped(view: IView, event: MouseEvent) {
        if (!this.snapToFeaturePoint(view, event)) {
            this._snaped = this.findSnaped(ShapeType.Edge, view, event);
            this.snaps.forEach((x) => {
                x.handleSnaped?.(view.document.visual.document, this._snaped);
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
            if (snaped && this.validateSnaped(snaped)) return snaped;
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
        let shapes = view.detectShapes(shapeType, event.offsetX, event.offsetY, this.data.filter);
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
        if (msg === undefined || msg === "") {
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
                VisualConfig.temporaryVertexSize,
                VisualConfig.temporaryVertexColor,
            );
            this._tempPoint = this.document.visual.context.displayMesh(data);
        }
        this._tempShapes = this.data.preview?.(point)?.map((shape) => {
            return this.document.visual.context.displayMesh(shape);
        });
    }

    private removeTempShapes() {
        if (this._tempPoint) {
            this.document.visual.context.removeMesh(this._tempPoint);
            this._tempPoint = undefined;
        }
        this._tempShapes?.forEach((x) => {
            this.document.visual.context.removeMesh(x);
        });
        this.document.visual.update();
        this._tempShapes = undefined;
    }

    pointerDown(view: IView, event: MouseEvent): void {
        if (event.button === 0) {
            this.finish();
        }
    }
    pointerUp(view: IView, event: MouseEvent): void {}
    mouseWheel(view: IView, event: WheelEvent): void {
        view.update();
    }
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this._snaped = undefined;
            this.cancel();
        } else if (event.key === "Enter") {
            this._snaped = undefined;
            this.finish();
        } else if (["-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)) {
            PubSub.default.pub("showInput", event.key, (text: string) => {
                let error = this.inputError(text);
                if (error !== undefined) {
                    return Result.err(error);
                }
                this.handleText(view, text);
                return Result.ok(text);
            });
        }
    }

    private readonly handleText = (view: IView, text: string) => {
        this._snaped = this.getPointFromInput(view, text);
        this.finish();
    };

    protected abstract getPointFromInput(view: IView, text: string): SnapedData;

    protected abstract inputError(text: string): I18nKeys | undefined;
}
