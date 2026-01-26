// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    Config,
    type I18nKeys,
    type IDocument,
    type IEventHandler,
    type IView,
    MeshDataUtils,
    MessageType,
    PubSub,
    Result,
    ShapeType,
    screenDistance,
    VisualConfig,
    type XYZ,
} from "chili-core";
import type { ISnap, MouseAndDetected, SnapData, SnapResult } from "../snap";

enum SnapState {
    Idle,
    Snapping,
    Inputing,
    Cancelled,
    Completed,
}

export abstract class SnapEventHandler<D extends SnapData = SnapData> implements IEventHandler {
    private _tempPoint?: number;
    private _tempShapes?: number[];
    protected showTempPoint: boolean = true;
    protected _snaped?: SnapResult;
    private _state: SnapState = SnapState.Idle;

    facePreviewOpacity: number = 1;
    isEnabled: boolean = true;

    constructor(
        readonly document: IDocument,
        readonly controller: AsyncController,
        readonly snaps: ISnap[],
        readonly data: D,
    ) {
        this.showTempShape(undefined);
        controller.onCancelled(() => this.handleCancel());
        controller.onCompleted(() => this.handleSuccess());
    }

    get snaped() {
        return this._snaped;
    }
    get state() {
        return this._state;
    }

    dispose() {
        this._snaped = undefined;
        this._state = SnapState.Completed;
    }

    private handleSuccess() {
        if (this._state === SnapState.Completed) return;

        this._state = SnapState.Completed;
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
        this.clearSnapPrompt();
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
            this.showSnapPrompt(this._snaped);
        } else {
            this.clearSnapPrompt();
        }
    }

    private updateVisualFeedback(view: IView) {
        this.showTempShape(this._snaped?.point);
        view.document.visual.update();
    }

    protected setSnaped(view: IView, event: PointerEvent) {
        this.findSnapPoint(ShapeType.Edge | ShapeType.Vertex, view, event);

        this.snaps.forEach((snap) => snap.handleSnaped?.(view.document.visual.document, this._snaped));
    }

    private findNearestFeaturePoint(view: IView, event: PointerEvent) {
        let minDist = Number.MAX_VALUE;
        let nearest;

        for (const point of this.data.featurePoints || []) {
            if (point.when && !point.when()) continue;

            const dist = screenDistance(view, event.offsetX, event.offsetY, point.point);
            if (dist < minDist) {
                minDist = dist;
                nearest = point;
            }
        }

        return minDist < Config.instance.SnapDistance ? nearest : undefined;
    }

    protected findSnapPoint(shapeType: ShapeType, view: IView, event: PointerEvent) {
        const featurePoint = this.findNearestFeaturePoint(view, event);
        if (featurePoint) {
            this._snaped = {
                view,
                point: featurePoint.point,
                info: featurePoint.prompt,
                shapes: [],
            };
        } else {
            const detected = this.detectShapes(shapeType, view, event);
            for (const snap of this.snaps) {
                const snaped = snap.snap(detected);
                if (snaped && this.validateSnapPoint(snaped)) {
                    this._snaped = snaped;
                    return;
                }
            }
        }
    }

    private validateSnapPoint(snaped: SnapResult) {
        return !this.data.validator || this.data.validator(snaped.point!);
    }

    private detectShapes(shapeType: ShapeType, view: IView, event: MouseEvent): MouseAndDetected {
        const shapes = view.detectShapes(shapeType, event.offsetX, event.offsetY, this.data.filter);
        return { shapes, view, mx: event.offsetX, my: event.offsetY };
    }

    protected clearSnapPrompt() {
        PubSub.default.pub("clearFloatTip");
    }

    protected showSnapPrompt(snaped: SnapResult) {
        const prompt = this.formatSnapPrompt(snaped);
        if (!prompt) {
            this.clearSnapPrompt();
            return;
        }
        PubSub.default.pub("showFloatTip", prompt);
    }

    protected formatSnapPrompt(
        snaped: SnapResult,
    ): HTMLElement | { level: MessageType; msg: string } | undefined {
        let prompt = this.data.prompt?.(snaped);
        if (!prompt) {
            const distance = snaped.distance ?? snaped.refPoint?.distanceTo(snaped.point!);
            if (distance) {
                prompt = this.formatSnapDistance(distance);
            }
        }

        if (!prompt && !snaped.info) {
            return undefined;
        }

        return {
            level: MessageType.info,
            msg: [snaped.info, prompt].filter((x) => x !== undefined).join(" -> "),
        };
    }

    protected formatSnapDistance(num: number) {
        return num.toFixed(2);
    }

    private removeTempVisuals() {
        this.removeTempShapes();
        this.snaps.forEach((snap) => snap.removeDynamicObject());
    }

    private showTempShape(point: XYZ | undefined) {
        if (point && this.showTempPoint) {
            const data = MeshDataUtils.createVertexMesh(
                point,
                VisualConfig.temporaryVertexSize,
                VisualConfig.temporaryVertexColor,
            );
            this._tempPoint = this.document.visual.context.displayMesh([data]);
        }

        this._tempShapes = this.data
            .preview?.(point)
            ?.map((shape) => this.document.visual.context.displayMesh([shape], this.facePreviewOpacity));
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

    pointerOut(view: IView, event: PointerEvent) {
        this._snaped = undefined;
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

        this._state = SnapState.Inputing;
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
