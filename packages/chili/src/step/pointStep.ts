// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, I18nKeys, IDocument, Precision, XYZ } from "chili-core";
import {
    Dimension,
    PointSnapData,
    PointSnapEventHandler,
    SnapPointOnCurveData,
    SnapPointOnCurveEventHandler,
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
