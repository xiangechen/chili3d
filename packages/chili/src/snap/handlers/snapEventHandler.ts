// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
import { ISnap, MouseAndDetected, SnapData, SnapResult } from "../snap";

enum SnapState {
    Idle,
    Snapping,
    InputMode,
    Cancelled,
}

export abstract class SnapEventHandler<D extends SnapData = SnapData> implements IEventHandler {
    private _tempPoint?: number;
    private _tempShapes?: number[];
    protected _snaped?: SnapResult;
    private _state: SnapState = SnapState.Idle;

    constructor(
        readonly document: IDocument,
        readonly controller: AsyncController,
        readonly snaps: ISnap[],
        readonly data: D,
    ) {
        this.showTempShape(undefined);
        controller.onCancelled(() => this.handleCancel());
    }

    get snaped() {
        return this._snaped;
    }
    get state() {
        return this._state;
    }

    dispose() {
        this._snaped = undefined;
        this._state = SnapState.Idle;
    }

    private handleSuccess() {
        this._state = SnapState.Idle;
        this.controller.success();
        this.cleanupResources();
    }

    private handleCancel() {
        if (this._state === SnapState.Cancelled) return;
        this._state = SnapState.Cancelled;
        this.controller.cancel();
        this.cleanupResources();
    }

    private cleanupResources() {
        this.clearSnapTip();
        this.clearInput();
        this.removeTempVisuals();
        this.snaps.forEach((snap) => snap.clear());
    }

    private clearInput() {
        PubSub.default.pub("clearInput");
    }

    pointerMove(view: IView, event: PointerEvent): void {
        this._state = SnapState.Snapping;
        this.removeTempVisuals();
        this.updateSnapPoint(view, event);
        this.updateVisualFeedback(view);
    }

    private updateSnapPoint(view: IView, event: PointerEvent) {
        this.setSnaped(view, event);
        if (this._snaped) {
            this.showSnapPrompt(this.formatPrompt(this._snaped));
        } else {
            this.clearSnapTip();
        }
    }

    private updateVisualFeedback(view: IView) {
        this.showTempShape(this._snaped?.point);
        view.document.visual.update();
    }

    private formatPrompt(snaped: SnapResult) {
        let prompt = this.data.prompt?.(snaped);
        if (!prompt) {
            let distance = snaped.distance ?? snaped.refPoint?.distanceTo(snaped.point!);
            if (distance) {
                prompt = `${distance.toFixed(2)}`;
            }
        }

        return [snaped.info, prompt].filter((x) => x !== undefined).join(" -> ");
    }

    protected setSnaped(view: IView, event: PointerEvent) {
        if (this.trySnapToFeaturePoint(view, event)) return;

        this._snaped = this.findSnapPoint(ShapeType.Edge, view, event);
        this.snaps.forEach((snap) => snap.handleSnaped?.(view.document.visual.document, this._snaped));
    }

    private trySnapToFeaturePoint(view: IView, event: PointerEvent) {
        const featurePoint = this.findNearestFeaturePoint(view, event);
        if (!featurePoint) return false;

        this._snaped = {
            view,
            point: featurePoint.point,
            info: featurePoint.prompt,
            shapes: [],
        };
        return true;
    }

    private findNearestFeaturePoint(view: IView, event: PointerEvent) {
        let minDist = Number.MAX_VALUE;
        let nearest;

        for (const point of this.data.featurePoints || []) {
            if (point.when && !point.when()) continue;

            const dist = IView.screenDistance(view, event.offsetX, event.offsetY, point.point);
            if (dist < minDist) {
                minDist = dist;
                nearest = point;
            }
        }

        return minDist < Config.instance.SnapDistance ? nearest : undefined;
    }

    private findSnapPoint(shapeType: ShapeType, view: IView, event: MouseEvent) {
        const detected = this.detectShapes(shapeType, view, event);
        for (const snap of this.snaps) {
            const snaped = snap.snap(detected);
            if (snaped && this.validateSnapPoint(snaped)) return snaped;
        }
        return undefined;
    }

    private validateSnapPoint(snaped: SnapResult) {
        return !this.data.validator || this.data.validator(snaped.point!);
    }

    private detectShapes(shapeType: ShapeType, view: IView, event: MouseEvent): MouseAndDetected {
        const shapes = view.detectShapes(shapeType, event.offsetX, event.offsetY, this.data.filter);
        return { shapes, view, mx: event.offsetX, my: event.offsetY };
    }

    private clearSnapTip() {
        PubSub.default.pub("clearFloatTip");
    }

    private showSnapPrompt(msg: string | undefined) {
        if (!msg) {
            this.clearSnapTip();
            return;
        }
        PubSub.default.pub("showFloatTip", MessageType.info, msg);
    }

    private removeTempVisuals() {
        this.removeTempShapes();
        this.snaps.forEach((snap) => snap.removeDynamicObject());
    }

    private showTempShape(point: XYZ | undefined) {
        if (point) {
            const data = VertexMeshData.from(
                point,
                VisualConfig.temporaryVertexSize,
                VisualConfig.temporaryVertexColor,
            );
            this._tempPoint = this.document.visual.context.displayMesh([data]);
        }

        this._tempShapes = this.data
            .preview?.(point)
            ?.map((shape) => this.document.visual.context.displayMesh([shape]));
    }

    private removeTempShapes() {
        if (this._tempPoint) {
            this.document.visual.context.removeMesh(this._tempPoint);
            this._tempPoint = undefined;
        }
        this._tempShapes?.forEach((id) => {
            this.document.visual.context.removeMesh(id);
        });
        this.document.visual.update();
        this._tempShapes = undefined;
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.pointerType === "mouse" && event.button === 0) {
            if (this._snaped) {
                this.handleSuccess();
            } else {
                PubSub.default.pub("showToast", "toast.snap.notFoundValidPoint");
            }
        }
    }

    pointerUp(view: IView, event: PointerEvent): void {
        if (event.pointerType !== "mouse" && event.isPrimary && this._snaped) {
            this.handleSuccess();
        }
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.update();
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        switch (event.key) {
            case "Escape":
                this._snaped = undefined;
                this.handleCancel();
                break;
            case "Enter":
                this._snaped = undefined;
                this.handleSuccess();
                break;
            default:
                this.handleNumericInput(view, event);
        }
    }

    private handleNumericInput(view: IView, event: KeyboardEvent) {
        if (!["#", "-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)) return;

        this._state = SnapState.InputMode;
        PubSub.default.pub("showInput", event.key, (text: string) => {
            const error = this.inputError(text);
            if (error) return Result.err(error);

            this._snaped = this.getPointFromInput(view, text);
            this.handleSuccess();
            return Result.ok(text);
        });
    }

    protected abstract getPointFromInput(view: IView, text: string): SnapResult;
    protected abstract inputError(text: string): I18nKeys | undefined;
}
