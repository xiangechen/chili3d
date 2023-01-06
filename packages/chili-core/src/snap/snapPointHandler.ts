// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result, XYZ, ObjectSnapType, I18n, MessageLevel, Valid } from "chili-shared";
import { IEventHandler, IView } from "chili-vis";
import { SnapInfo } from "./interfaces";
import { ObjectSnap } from "./objectSnap";
import { WorkplaneSnap } from "./workplaneSnap";
import { PubSub, IDocument, Configure } from "chili-core";
import { TrackingSnap } from "./tracking";
import { Dimension } from "./inputDimension";
import { HandleTempShape } from "./shapeHandle";
import { VertexRenderData } from "chili-geo";

export enum SnapState {
    Snaping,
    Cancel,
    Success,
    Fail,
}

export class SnapPointEventHandler implements IEventHandler {
    private _tempPointId?: number;
    private _tempShapeId?: number;
    private _objectSnap: ObjectSnap;
    private _trackingSnap: TrackingSnap;
    private _workplaneSnap: WorkplaneSnap;
    private _snapedInfo?: SnapInfo;

    constructor(
        readonly document: IDocument,
        private _endSnapCallback: () => void,
        readonly dimension: Dimension,
        readonly referencePoint?: XYZ,
        private _createTempShape?: HandleTempShape
    ) {
        this._objectSnap = new ObjectSnap(this.document.selection, Configure.current.snapType);
        this._workplaneSnap = new WorkplaneSnap();
        this._trackingSnap = new TrackingSnap(referencePoint);
        PubSub.default.sub("snapChanged", this.onSnapChanged);
    }

    private onSnapChanged = (snapType: ObjectSnapType) => {
        this._objectSnap.onSnapTypeChanged(snapType);
    };

    get snapedPoint() {
        return this._snapedInfo?.point;
    }

    private stopSnap(view: IView) {
        this._endSnapCallback();
        this.clearSnap();

        this.removeInput();
        this.removeTempShapes(view);
        this._objectSnap.clear();
        this._trackingSnap.clear();
        this._workplaneSnap.clear();

        PubSub.default.sub("snapChanged", this.onSnapChanged);

        view.document.viewer.redraw();
    }

    private removeInput() {
        PubSub.default.pub("clearInput");
    }

    mouseMove(view: IView, event: MouseEvent): void {
        this._snapedInfo = undefined;
        this.removeDynamicObject(view);
        if (this._objectSnap.snap(view, event.offsetX, event.offsetY)) {
            this._snapedInfo = this._objectSnap.point();
        }
        this._trackingSnap.objectTracking.handleSnapForTracking(view, this._snapedInfo!);
        if (this._snapedInfo === undefined) {
            this._trackingSnap.setDetectedShape(this._objectSnap.getDetectedShape());
            if (this._trackingSnap.snap(view, event.offsetX, event.offsetY)) {
                this._snapedInfo = this._trackingSnap.point();
            } else if (this._workplaneSnap.snap(view, event.offsetX, event.offsetY)) {
                this._snapedInfo = this._workplaneSnap.point();
            }
        }
        if (this._snapedInfo !== undefined) {
            this.showTemp(this._snapedInfo.point, view);
            this.showSnaped(this._snapedInfo);
        } else {
            this.clearSnap();
        }
        view.document.viewer.redraw();
    }

    private clearSnap() {
        PubSub.default.pub("clearFloatTip");
    }

    private showSnaped(snapedInfo: SnapInfo) {
        if (snapedInfo.info !== undefined) {
            PubSub.default.pub("floatTip", MessageLevel.info, snapedInfo.info);
        } else {
            this.clearSnap();
        }
    }

    private removeDynamicObject(view: IView) {
        this.removeTempShapes(view);
        this._objectSnap.removeDynamicObject();
        this._trackingSnap.removeDynamicObject();
        this._workplaneSnap.removeDynamicObject();
    }

    private showTemp(point: XYZ, view: IView) {
        let data = VertexRenderData.from(point, 0xff0000, 3);
        this._tempPointId = view.document.visualization.context.temporaryDisplay(data);
        if (this._createTempShape !== undefined) {
            let shape = this._createTempShape(point)
                ?.mesh()
                .edges.map((x) => x.renderData);
            if (shape !== undefined) this._tempShapeId = view.document.visualization.context.temporaryDisplay(...shape);
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

    mouseDown(view: IView, event: MouseEvent): void {
        if (event.button === 0) {
            this.stopSnap(view);
        }
    }
    mouseUp(view: IView, event: MouseEvent): void {}
    mouseOut(view: IView, event: MouseEvent): void {}
    mouseWheel(view: IView, event: WheelEvent): void {
        view.document.viewer.redraw();
    }
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.stopSnap(view);
        } else if (event.key in ["-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
            PubSub.default.pub("showInput", this.handleValid, (text: string) => this.handleInput(view, text));
        }
    }

    private handleInput = (view: IView, text: string) => {
        let inputValue = this.getInput(view, text);
        if (inputValue.isOk()) {
            this._snapedInfo = {
                point: inputValue.value!,
                shapes: [],
            };
            this.stopSnap(view);
        }
    };

    private getInput(view: IView, text: string): Result<XYZ, keyof I18n> {
        let dims = text.split(",").map((x) => Number(x));
        let result = this.referencePoint ?? XYZ.zero;
        let end = this._snapedInfo!.point;
        if (dims.length === 1 && end !== undefined) {
            let vector = end.sub(this.referencePoint!).normalize()!;
            result = result.add(vector.multiply(dims[0]));
        } else if (dims.length > 1) {
            result = result
                .add(view.workplane.xDirection.multiply(dims[0]))
                .add(view.workplane.yDirection.multiply(dims[1]));
            if (dims.length === 3) {
                result = result.add(view.workplane.normal.multiply(dims[2]));
            }
        }
        return Result.ok(result);
    }

    private handleValid = (text: string) => {
        let dims = text.split(",").map((x) => Number(x));
        let dimension = Dimension.from(dims.length);
        if (!Dimension.contains(this.dimension, dimension)) {
            return Valid.error("error.input.maxInput");
        } else if (dims.some((x) => Number.isNaN(x))) {
            return Valid.error("error.input.numberValid");
        } else {
            if (this.referencePoint === undefined) {
                if (dims.length !== 3) {
                    return Valid.error("error.input.whenNullOnlyThreeNumber");
                }
            } else {
                if (
                    dims.length === 1 &&
                    (this._snapedInfo === undefined || this._snapedInfo.point.isEqualTo(this.referencePoint))
                ) {
                    return Valid.error("error.input.whenOverlapfNotOneNumber");
                }
            }
        }
        return Valid.ok();
    };

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
