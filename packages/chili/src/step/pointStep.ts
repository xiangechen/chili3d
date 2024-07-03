// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, I18nKeys, IDocument, Precision, XYZ } from "chili-core";
import {
    Dimension,
    PointSnapData,
    PointSnapEventHandler,
    SnapPointOnCurveData,
    SnapPointOnCurveEventHandler,
} from "../snap";
import { Step } from "./step";

function defaultSnapedData(): PointSnapData {
    return {
        dimension: Dimension.D1 | Dimension.D1D2D3,
    };
}

export class PointStep extends Step<PointSnapData> {
    constructor(tip: I18nKeys, handleData: () => PointSnapData = defaultSnapedData) {
        super(tip, handleData);
    }

    protected getEventHandler(document: IDocument, controller: AsyncController, data: PointSnapData) {
        return new PointSnapEventHandler(document, controller, data);
    }

    protected validator(data: PointSnapData, point: XYZ): boolean {
        if (data.refPoint === undefined) return true;
        return data.refPoint().distanceTo(point) > Precision.Distance;
    }
}

export class PointOnCurveStep extends Step<SnapPointOnCurveData> {
    constructor(tip: I18nKeys, handleData: () => SnapPointOnCurveData) {
        super(tip, handleData);
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
