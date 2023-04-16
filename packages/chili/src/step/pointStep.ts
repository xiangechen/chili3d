// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, XYZ } from "chili-core";

import { Dimension, PointSnapper, SnapPointData } from "../snap";
import { StepBase } from "./step";

function defaultSnapedData(): SnapPointData {
    return {
        dimension: Dimension.D1D2D3,
    };
}

export class PointStep extends StepBase<SnapPointData> {
    constructor(
        tip: keyof I18n,
        handleData: () => SnapPointData = defaultSnapedData,
        disableDefaultValidator = false
    ) {
        super(PointSnapper, tip, handleData, disableDefaultValidator);
    }

    protected validator(data: SnapPointData, point: XYZ): boolean {
        if (data.refPoint === undefined) return true;
        return data.refPoint.distanceTo(point) > 0;
    }
}
