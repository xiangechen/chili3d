// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, Configure, IView, Validation, XYZ } from "chili-core";

import { Dimension } from "./dimension";
import { SnapedData } from "./interfaces";
import { ObjectSnap } from "./objectSnap";
import { ShapeFromPoint } from "./shapeFromPoint";
import { SnapEventHandlerBase } from "./snapEventHandlerBase";
import { TrackingSnap } from "./tracking";
import { WorkplaneSnap } from "./workplaneSnap";

export interface SnapPointData {
    dimension: Dimension;
    refPoint?: XYZ;
    validator?: (view: IView, point: XYZ) => boolean;
    shapeCreator?: ShapeFromPoint;
}

export class SnapPointEventHandler extends SnapEventHandlerBase {
    constructor(cancellationToken: CancellationToken, readonly data: SnapPointData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let workplaneSnap = new WorkplaneSnap();
        let trackingSnap = new TrackingSnap(data.dimension, data.refPoint);
        let snaps = [objectSnap, trackingSnap, workplaneSnap];
        super(cancellationToken, snaps, [trackingSnap]);
    }

    protected isValid(view: IView, snaped: SnapedData): boolean {
        return this.data.validator === undefined || this.data.validator(view, snaped.point);
    }

    protected createTempShape(view: IView, point: XYZ): number | undefined {
        if (this.data.shapeCreator == undefined) return undefined;
        let shape = this.data
            .shapeCreator(view, point)
            ?.mesh()
            .edges.map((x) => x.renderData);
        if (shape === undefined) return undefined;
        return view.document.visualization.context.temporaryDisplay(...shape);
    }

    protected getInput(view: IView, text: string): XYZ {
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

    protected handleValid(text: string) {
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
    }
}
