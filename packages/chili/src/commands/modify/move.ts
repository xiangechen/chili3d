// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Matrix4, XYZ, command } from "chili-core";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { TransformedCommand } from "./transformedCommand";

@command({
    name: "modify.move",
    display: "command.move",
    icon: "icon-move",
})
export class Move extends TransformedCommand {
    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            preview: this.movePreview,
        };
    };

    private movePreview = (point: XYZ | undefined) => {
        let p1 = this.previewPoint(this.stepDatas[0].point!);
        if (!point) return [p1];
        let models = this.transformPreview(point);
        let line = this.getTempLineData(this.stepDatas[0].point!, point);
        return [p1, models, line];
    };

    protected override transfrom(point: XYZ): Matrix4 {
        let vector = point.sub(this.stepDatas[0].point!);
        return Matrix4.createTranslation(vector.x, vector.y, vector.z);
    }
}
