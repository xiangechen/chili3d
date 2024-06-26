// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, Precision, XYZ } from "chili-core";
import {
    Dimension,
    PointOnCurveSnapper,
    PointSnapper,
    SnapPointData,
    SnapPointOnCurveData,
    Snapper,
} from "../snap";
import { StepBase } from "./step";

function defaultSnapedData(): SnapPointData {
    return {
        dimension: Dimension.D1 | Dimension.D1D2D3,
    };
}

export class PointStep extends StepBase<SnapPointData> {
    constructor(tip: I18nKeys, handleData: () => SnapPointData = defaultSnapedData) {
        super(tip, handleData);
    }

    protected override snapper(data: SnapPointData): Snapper {
        return new PointSnapper(data);
    }

    protected validator(data: SnapPointData, point: XYZ): boolean {
        if (data.refPoint === undefined) return true;
        return data.refPoint().distanceTo(point) > Precision.Distance;
    }
}

export class PointOnCurveStep extends StepBase<SnapPointOnCurveData> {
    constructor(tip: I18nKeys, handleData: () => SnapPointOnCurveData) {
        super(tip, handleData);
    }

    protected override validator(data: SnapPointOnCurveData, point: XYZ): boolean {
        return true;
    }

    protected override snapper(data: SnapPointOnCurveData): Snapper {
        return new PointOnCurveSnapper(data);
    }
}
