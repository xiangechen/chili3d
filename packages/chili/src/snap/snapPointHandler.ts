// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    CancellationToken,
    Configure,
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

import { Dimension } from "./dimension";
import { DetectedData, ISnap, SnapChangedHandler, SnapedData } from "./interfaces";
import { ObjectSnap } from "./objectSnap";
import { ShapeFromPoint } from "./shapeFromPoint";
import { TrackingSnap } from "./tracking";
import { WorkplaneSnap } from "./workplaneSnap";

export interface SnapPointData {
    dimension: Dimension;
    refPoint?: XYZ;
    validator?: (view: IView, point: XYZ) => boolean;
    shapeCreator?: ShapeFromPoint;
}

export class SnapPointEventHandler implements IEventHandler {
    private readonly _snaps: ISnap[];
    private readonly _snapedChangedHandlers: Set<SnapChangedHandler> = new Set();
    private _tempPointId?: number;
    private _tempShapeId?: number;
    private _snaped?: SnapedData;

    constructor(private _cancellationToken: CancellationToken, readonly data: SnapPointData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let workplaneSnap = new WorkplaneSnap();
        let trackingSnap = new TrackingSnap(data.dimension, data.refPoint);
        this._snaps = [objectSnap, trackingSnap, workplaneSnap];
        this._snapedChangedHandlers.add(trackingSnap);
        PubSub.default.sub("snapChanged", this.onSnapChanged);
    }

    private onSnapChanged = (snapType: ObjectSnapType) => {
        this._snaps.forEach((x) => x.onSnapTypeChanged(snapType));
    };

    get snapedPoint() {
        return this._snaped?.point;
    }

    private stopSnap(view: IView) {
        this._snapedChangedHandlers.clear();
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
            if (this.data.validator === undefined || this.data.validator(view, snaped.point)) {
                return snaped;
            }
        }

        return undefined;
    }

    private getDetectedData(view: IView, event: MouseEvent) {
        view.document.selection.setSelectionType(ShapeType.Edge);
        let shapes = view.document.selection.detectedShapes(view, event.offsetX, event.offsetY);
        let data: DetectedData = {
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
        if (this.data.shapeCreator !== undefined) {
            let shape = this.data
                .shapeCreator(view, point)
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
            this._snaped = undefined;
            this.stopSnap(view);
        } else if (event.key in ["-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
            PubSub.default.pub("showInput", this.handleValid, (text: string) => this.handleInput(view, text));
        }
    }

    private handleInput = (view: IView, text: string) => {
        this._snaped = {
            point: this.getInput(view, text),
            shapes: [],
        };
        this.stopSnap(view);
    };

    private getInput(view: IView, text: string): XYZ {
        let dims = text.split(",").map((x) => Number(x));
        let result = this.data.refPoint ?? XYZ.zero;
        let end = this._snaped!.point;
        if (dims.length === 1 && end !== undefined) {
            let vector = end.sub(this.data.refPoint!).normalize()!;
            result = result.add(vector.multiply(dims[0]));
        } else if (dims.length > 1) {
            result = result.add(view.workplane.x.multiply(dims[0])).add(view.workplane.y.multiply(dims[1]));
            if (dims.length === 3) {
                result = result.add(view.workplane.normal.multiply(dims[2]));
            }
        }
        return result;
    }

    private handleValid = (text: string) => {
        let dims = text.split(",").map((x) => Number(x));
        let dimension = Dimension.from(dims.length);
        if (!Dimension.contains(this.data.dimension, dimension)) {
            return Validation.error("error.input.unsupportedInputs");
        } else if (dims.some((x) => Number.isNaN(x))) {
            return Validation.error("error.input.invalidNumber");
        } else {
            if (this.data.refPoint === undefined) {
                if (dims.length !== 3) {
                    return Validation.error("error.input.threeNumberCanBeInput");
                }
            } else {
                if (
                    dims.length === 1 &&
                    (this._snaped === undefined || this._snaped.point.isEqualTo(this.data.refPoint))
                ) {
                    return Validation.error("error.input.cannotInputANumber");
                }
            }
        }
        return Validation.ok();
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
