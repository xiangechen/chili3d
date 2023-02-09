// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IView, XYZ } from "chili-core";
import { PointSnapper, SnapPointData } from "../../snap";
import { StepBase } from "./step";

export class PointStep extends StepBase<SnapPointData> {
    constructor(tip: keyof I18n, handleData: () => SnapPointData, disableDefaultValidator = false) {
        super(PointSnapper, tip, handleData, disableDefaultValidator);
    }

    protected validator(view: IView, data: SnapPointData, point: XYZ): boolean {
        if (data.refPoint === undefined) return true;
        return data.refPoint.distanceTo(point) > 0;
    }
}
