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
        const objectSnap = new ObjectSnap(Config.instance.snapType, pointData.refPoint);
        const workplaneSnap = pointData.plane
            ? new PlaneSnap(pointData.plane, pointData.refPoint)
            : new WorkplaneSnap(pointData.refPoint);
        const trackingSnap = new TrackingSnap(pointData.refPoint, true);
        super(document, controller, [objectSnap, trackingSnap, workplaneSnap], pointData);
    }

    protected getPointFromInput(view: IView, text: string): SnapedData {
        const dims = text.split(",").map(Number);
        const refPoint = this.getRefPoint() ?? XYZ.zero;
        const result = { point: refPoint, view, shapes: [] };
        const end = this._snaped?.point;

        if (dims.length === 1 && end !== undefined) {
            const vector = end.sub(refPoint).normalize()!;
            result.point = result.point.add(vector.multiply(dims[0]));
        } else if (dims.length > 1) {
            const plane = this.data.plane?.() ?? view.workplane;
            result.point = result.point.add(plane.xvec.multiply(dims[0])).add(plane.yvec.multiply(dims[1]));
            if (dims.length === 3) {
                result.point = result.point.add(plane.normal.multiply(dims[2]));
            }
        }
        return result;
    }

    protected inputError(text: string): I18nKeys | undefined {
        const dims = text.split(",").map(Number);
        const dimension = Dimension.from(dims.length);
        if (!Dimension.contains(this.data.dimension!, dimension)) return "error.input.unsupportedInputs";
        if (dims.some(Number.isNaN)) return "error.input.invalidNumber";

        const refPoint = this.getRefPoint();
        if (refPoint === undefined && dims.length !== 3) return "error.input.threeNumberCanBeInput";
        if (this.cannotOneNumber(dims, refPoint)) return "error.input.cannotInputANumber";
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
        const objectSnap = new ObjectSnap(Config.instance.snapType);
        const snap = new PointOnCurveSnap(pointData);
        const workplaneSnap = new WorkplaneSnap();
        super(document, controller, [objectSnap, snap, workplaneSnap], pointData);
    }

    protected override getPointFromInput(view: IView, text: string): SnapedData {
        const length = this.data.curve.length();
        const parameter = Number(text) / length;
        return { point: this.data.curve.value(parameter), view, shapes: [] };
    }

    protected override inputError(text: string) {
        return Number.isNaN(Number(text)) ? "error.input.invalidNumber" : undefined;
    }
}
