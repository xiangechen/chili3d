// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, Precision, XYZ } from "chili-core";

import { AngleSnapper, Dimension, SnapPointData, Snapper } from "../snap";
import { StepBase } from "./step";

function defaultSnapedData(): SnapPointData {
    return {
        dimension: Dimension.D1D2D3,
    };
}

export class AngleStep extends StepBase<SnapPointData> {
    constructor(
        tip: I18nKeys,
        private handleP1: () => XYZ,
        handleCenter: () => SnapPointData = defaultSnapedData,
    ) {
        super(tip, handleCenter);
    }

    protected override snapper(data: SnapPointData): Snapper {
        return new AngleSnapper(data, this.handleP1());
    }

    protected validator(data: SnapPointData, point: XYZ): boolean {
        if (data.refPoint === undefined) return true;
        return data.refPoint.distanceTo(point) > Precision.Length;
    }
}
