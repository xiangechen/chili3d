// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, Config, I18nKeys, IDocument, IView, XYZ } from "chili-core";
import { Dimension } from "../dimension";
import { SnapedData } from "../snap";
import { ObjectSnap, PlaneSnap, PointOnCurveSnap, WorkplaneSnap } from "../snaps";
import { TrackingSnap } from "../tracking";
import { PointSnapData, SnapPointOnCurveData } from "./pointSnapData";
import { SnapEventHandler } from "./snapEventHandler";

export class PointSnapEventHandler extends SnapEventHandler<PointSnapData> {
    constructor(document: IDocument, controller: AsyncController, pointData: PointSnapData) {
        let objectSnap = new ObjectSnap(Config.instance.snapType, pointData.refPoint);
        let workplaneSnap = pointData.plane
            ? new PlaneSnap(pointData.plane, pointData.refPoint)
            : new WorkplaneSnap(pointData.refPoint);
        let trackingSnap = new TrackingSnap(pointData.refPoint, true);
        let snaps = [objectSnap, trackingSnap, workplaneSnap];
        super(document, controller, snaps, pointData);
    }

    protected getPointFromInput(view: IView, text: string): SnapedData {
        let dims = text.split(",").map((x) => Number(x));
        let refPoint = this.getRefPoint();
        let result = {
            point: refPoint ?? XYZ.zero,
            view,
            shapes: [],
        };
        let end = this._snaped!.point!;
        if (dims.length === 1 && end !== undefined) {
            let vector = end.sub(refPoint!).normalize()!;
            result.point = result.point.add(vector.multiply(dims[0]));
        } else if (dims.length > 1) {
            let plane = this.data.plane?.() ?? view.workplane;
            result.point = result.point.add(plane.xvec.multiply(dims[0])).add(plane.yvec.multiply(dims[1]));
            if (dims.length === 3) {
                result.point = result.point.add(plane.normal.multiply(dims[2]));
            }
        }
        return result;
    }

    protected inputError(text: string): I18nKeys | undefined {
        let dims = text.split(",").map((x) => Number(x));
        let dimension = Dimension.from(dims.length);
        if (!Dimension.contains(this.data.dimension!, dimension)) {
            return "error.input.unsupportedInputs";
        }
        if (dims.some((x) => Number.isNaN(x))) {
            return "error.input.invalidNumber";
        }

        let refPoint = this.getRefPoint();
        if (refPoint === undefined && dims.length !== 3) {
            return "error.input.threeNumberCanBeInput";
        }
        if (this.cannotOneNumber(dims, refPoint)) {
            return "error.input.cannotInputANumber";
        }
        return undefined;
    }

    private cannotOneNumber(dims: number[], refPoint: XYZ | undefined) {
        return (
            dims.length === 1 &&
            refPoint &&
            (this._snaped === undefined || this._snaped.point!.isEqualTo(refPoint))
        );
    }

    private getRefPoint(): XYZ | undefined {
        return this.data.refPoint?.() ?? this._snaped?.refPoint;
    }
}

export class SnapPointOnCurveEventHandler extends SnapEventHandler<SnapPointOnCurveData> {
    constructor(document: IDocument, controller: AsyncController, pointData: SnapPointOnCurveData) {
        let objectSnap = new ObjectSnap(Config.instance.snapType);
        let snap = new PointOnCurveSnap(pointData);
        let workplaneSnap = new WorkplaneSnap();
        super(document, controller, [objectSnap, snap, workplaneSnap], pointData);
    }

    protected override getPointFromInput(view: IView, text: string): SnapedData {
        let length = this.data.curve.length();
        let parameter = Number(text) / length;
        return {
            point: this.data.curve.value(parameter),
            view,
            shapes: [],
        };
    }

    protected override inputError(text: string) {
        return Number.isNaN(Number(text)) ? "error.input.invalidNumber" : undefined;
    }
}
