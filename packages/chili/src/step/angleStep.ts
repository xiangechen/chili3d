// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, I18nKeys, IDocument, Precision, XYZ } from "chili-core";

import { AngleSnapEventHandler, Dimension, PointSnapData } from "../snap";
import { Step } from "./step";

function defaultSnapedData(): PointSnapData {
    return {
        dimension: Dimension.D1D2D3,
    };
}

export class AngleStep extends Step<PointSnapData> {
    constructor(
        tip: I18nKeys,
        private readonly handleCenter: () => XYZ,
        private readonly handleP1: () => XYZ,
        handleP2Data: () => PointSnapData = defaultSnapedData,
    ) {
        super(tip, handleP2Data);
    }

    protected getEventHandler(document: IDocument, controller: AsyncController, data: PointSnapData) {
        return new AngleSnapEventHandler(document, controller, this.handleCenter, this.handleP1(), data);
    }

    protected validator(data: PointSnapData, point: XYZ): boolean {
        if (data.refPoint === undefined) return true;
        return data.refPoint().distanceTo(point) > Precision.Distance;
    }
}
