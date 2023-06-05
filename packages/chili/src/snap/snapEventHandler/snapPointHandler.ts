// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { TaskToken, Config, I18n, IShape, IView, Plane, Validation, XYZ } from "chili-core";

import { Dimension } from "../dimension";
import { ObjectSnap } from "../objectSnap";
import { PlaneSnap, WorkplaneSnap } from "../planeSnap";
import { TrackingSnap } from "../tracking";
import { ShapePreviewer, Validator } from "./interfaces";
import { SnapEventHandler } from "./snapEventHandler";

export interface SnapPointData {
    dimension: Dimension;
    refPoint?: XYZ;
    validator?: Validator;
    preview?: ShapePreviewer;
    plane?: Plane;
}

export class SnapPointEventHandler extends SnapEventHandler {
    constructor(token: TaskToken, private pointData: SnapPointData) {
        let objectSnap = new ObjectSnap(Config.instance.snapType);
        let workplaneSnap = pointData.plane ? new PlaneSnap(pointData.plane) : new WorkplaneSnap();
        let trackingSnap = new TrackingSnap(pointData.refPoint, true);
        let snaps = [objectSnap, trackingSnap, workplaneSnap];
        super(token, {
            snaps,
            snapChangedHandlers: [trackingSnap],
            validator: pointData.validator,
            preview: pointData.preview,
        });
    }

    protected getPointFromInput(view: IView, text: string): XYZ {
        let dims = text.split(",").map((x) => Number(x));
        let result = this.pointData.refPoint ?? XYZ.zero;
        let end = this._snaped!.point;
        if (dims.length === 1 && end !== undefined) {
            let vector = end.sub(this.pointData.refPoint!).normalize()!;
            result = result.add(vector.multiply(dims[0]));
        } else if (dims.length > 1) {
            result = result.add(view.workplane.x.multiply(dims[0])).add(view.workplane.y.multiply(dims[1]));
            if (dims.length === 3) {
                result = result.add(view.workplane.normal.multiply(dims[2]));
            }
        }
        return result;
    }

    protected isTextValid(text: string) {
        let dims = text.split(",").map((x) => Number(x));
        let dimension = Dimension.from(dims.length);
        if (!Dimension.contains(this.pointData.dimension, dimension)) {
            return Validation.error<keyof I18n>("error.input.unsupportedInputs");
        } else if (dims.some((x) => Number.isNaN(x))) {
            return Validation.error<keyof I18n>("error.input.invalidNumber");
        } else {
            if (this.pointData.refPoint === undefined) {
                if (dims.length !== 3) {
                    return Validation.error<keyof I18n>("error.input.threeNumberCanBeInput");
                }
            } else {
                if (
                    dims.length === 1 &&
                    (this._snaped === undefined || this._snaped.point.isEqualTo(this.pointData.refPoint))
                ) {
                    return Validation.error<keyof I18n>("error.input.cannotInputANumber");
                }
            }
        }
        return Validation.ok<keyof I18n>();
    }
}
