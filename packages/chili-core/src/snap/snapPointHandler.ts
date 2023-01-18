// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result, XYZ, ObjectSnapType, I18n, MessageLevel, Valid, CancellationToken, ShapeType } from "chili-shared";
import { IEventHandler, IView } from "chili-vis";
import { SnapInfo } from "./interfaces";
import { ObjectSnap } from "./objectSnap";
import { WorkplaneSnap } from "./workplaneSnap";
import { PubSub, IDocument, Configure } from "chili-core";
import { TrackingSnap } from "./tracking";
import { Dimension } from "./dimension";
import { ShapeCreator } from "./shapeHandle";
import { VertexRenderData } from "chili-geo";

export enum SnapState {
    Snaping,
    Cancel,
    Success,
    Fail,
}

export interface SnapData {
    dimension: Dimension;
    refPoint?: XYZ;
    valid?: (view: IView, point: XYZ) => boolean;
    tempShape?: ShapeCreator;
}

export class SnapPointEventHandler implements IEventHandler {
    private _tempPointId?: number;
    private _tempShapeId?: number;
    private _objectSnap: ObjectSnap;
    private _trackingSnap: TrackingSnap;
    private _workplaneSnap: WorkplaneSnap;
    private _snapedInfo?: SnapInfo;

    constructor(private _cancellationToken: CancellationToken, readonly data: SnapData) {
        this._objectSnap = new ObjectSnap(Configure.current.snapType);
        this._workplaneSnap = new WorkplaneSnap();
        this._trackingSnap = new TrackingSnap(data.dimension, data.refPoint);
        PubSub.default.sub("snapChanged", this.onSnapChanged);
    }

    private onSnapChanged = (snapType: ObjectSnapType) => {
        this._objectSnap.onSnapTypeChanged(snapType);
    };

    get snapedPoint() {
        return this._snapedInfo?.point;
    }

    private stopSnap(view: IView) {
        this._cancellationToken.cancel();
        this.clearSnap();

        this.removeInput();
        this.removeTempShapes(view);
        this._objectSnap.clear();
        this._trackingSnap.clear();
        this._workplaneSnap.clear();

        view.document.selection.setSelectionType(ShapeType.Shape);
        PubSub.default.sub("snapChanged", this.onSnapChanged);

        view.document.viewer.redraw();
    }

    private removeInput() {
        PubSub.default.pub("clearInput");
    }

    mouseMove(view: IView, event: MouseEvent): void {
        this.removeTempObject(view);
        this._snapedInfo = this.getSnaped(view, event);
        if (this._snapedInfo !== undefined) {
            this.showTemp(this._snapedInfo.point, view);
            this.showSnaped(this._snapedInfo);
        } else {
            this.clearSnap();
        }
        view.document.viewer.update();
    }

    private getSnaped(view: IView, event: MouseEvent) {
        let snaped: SnapInfo | undefined = undefined;
        if (this._objectSnap.snap(view, event.offsetX, event.offsetY)) {
            snaped = this._objectSnap.point();
        }
        this._trackingSnap.showObjectTracking(view, snaped);
        if (snaped === undefined) {
            this._trackingSnap.setDetectedShape(this._objectSnap.getDetectedShape());
            if (this._trackingSnap.snap(view, event.offsetX, event.offsetY)) {
                snaped = this._trackingSnap.point();
            } else if (this._workplaneSnap.snap(view, event.offsetX, event.offsetY)) {
                snaped = this._workplaneSnap.point();
            }
        }
        if (snaped !== undefined && this.data.valid && !this.data.valid(view, snaped.point)) {
            return undefined;
        }
        return snaped;
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

    private removeTempObject(view: IView) {
        this.removeTempShapes(view);
        this._objectSnap.removeDynamicObject();
        this._trackingSnap.removeDynamicObject();
        this._workplaneSnap.removeDynamicObject();
    }

    private showTemp(point: XYZ, view: IView) {
        let data = VertexRenderData.from(point, 0xff0000, 3);
        this._tempPointId = view.document.visualization.context.temporaryDisplay(data);
        if (this.data.tempShape !== undefined) {
            let shape = this.data
                .tempShape(view, point)
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
        view.document.viewer.update();
    }
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this._snapedInfo = undefined;
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
        let result = this.data.refPoint ?? XYZ.zero;
        let end = this._snapedInfo!.point;
        if (dims.length === 1 && end !== undefined) {
            let vector = end.sub(this.data.refPoint!).normalize()!;
            result = result.add(vector.multiply(dims[0]));
        } else if (dims.length > 1) {
            result = result.add(view.workplane.x.multiply(dims[0])).add(view.workplane.y.multiply(dims[1]));
            if (dims.length === 3) {
                result = result.add(view.workplane.normal.multiply(dims[2]));
            }
        }
        return Result.ok(result);
    }

    private handleValid = (text: string) => {
        let dims = text.split(",").map((x) => Number(x));
        let dimension = Dimension.from(dims.length);
        if (!Dimension.contains(this.data.dimension, dimension)) {
            return Valid.error("error.input.unsupportedInputs");
        } else if (dims.some((x) => Number.isNaN(x))) {
            return Valid.error("error.input.invalidNumber");
        } else {
            if (this.data.refPoint === undefined) {
                if (dims.length !== 3) {
                    return Valid.error("error.input.threeNumberCanBeInput");
                }
            } else {
                if (
                    dims.length === 1 &&
                    (this._snapedInfo === undefined || this._snapedInfo.point.isEqualTo(this.data.refPoint))
                ) {
                    return Valid.error("error.input.cannotInputANumber");
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
