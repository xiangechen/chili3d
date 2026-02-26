// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type AsyncController, type I18nKeys, type IDocument, Precision, type XYZ } from "chili-core";
import {
    Dimension,
    type PointSnapData,
    PointSnapEventHandler,
    type SnapPointOnAxisData,
    SnapPointOnAxisEventHandler,
    type SnapPointOnCurveData,
    SnapPointOnCurveEventHandler,
    SnapPointPlaneEventHandler,
} from "../snap";
import { SnapStep } from "./step";

function defaultSnapedData(): PointSnapData {
    return { dimension: Dimension.D1 | Dimension.D1D2D3 };
}

export class PointStep extends SnapStep<PointSnapData> {
    constructor(tip: I18nKeys, handleData: () => PointSnapData = defaultSnapedData, keepSelected = false) {
        super(tip, handleData, keepSelected);
    }

    protected getEventHandler(document: IDocument, controller: AsyncController, data: PointSnapData) {
        return new PointSnapEventHandler(document, controller, data);
    }

    protected validator(data: PointSnapData, point: XYZ): boolean {
        return data.refPoint === undefined || data.refPoint().distanceTo(point) > Precision.Distance;
    }
}

export class PointOnCurveStep extends SnapStep<SnapPointOnCurveData> {
    constructor(tip: I18nKeys, handleData: () => SnapPointOnCurveData, keepSelected = false) {
        super(tip, handleData, keepSelected);
    }

    protected override validator(data: SnapPointOnCurveData, point: XYZ): boolean {
        return true;
    }

    protected override getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: SnapPointOnCurveData,
    ) {
        return new SnapPointOnCurveEventHandler(document, controller, data);
    }
}

export class PointOnAxisStep extends SnapStep<SnapPointOnAxisData> {
    constructor(tip: I18nKeys, handleData: () => SnapPointOnAxisData, keepSelected = false) {
        super(tip, handleData, keepSelected);
    }

    protected override validator(data: SnapPointOnAxisData, point: XYZ): boolean {
        return true;
    }

    protected override getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: SnapPointOnAxisData,
    ) {
        return new SnapPointOnAxisEventHandler(document, controller, data);
    }
}

export class PointOnPlaneStep extends SnapStep<PointSnapData> {
    constructor(tip: I18nKeys, handleData: () => PointSnapData, keepSelected = false) {
        super(tip, handleData, keepSelected);
    }

    protected override validator(data: PointSnapData, point: XYZ): boolean {
        return true;
    }

    protected override getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: SnapPointOnCurveData,
    ) {
        return new SnapPointPlaneEventHandler(document, controller, data);
    }
}
