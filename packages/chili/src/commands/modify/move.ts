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
        return [
            new PointStep("operate.pickFistPoint"),
            new PointStep("operate.pickNextPoint", this.getSecondPointData),
        ];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            preview: this.movePreview,
        };
    };

    private readonly movePreview = (point: XYZ | undefined) => {
        const p1 = this.previewPoint(this.stepDatas[0].point!);
        if (!point) return [p1];
        return [p1, this.transformPreview(point), this.getTempLineData(this.stepDatas[0].point!, point)];
    };

    protected override transfrom(point: XYZ): Matrix4 {
        const { x, y, z } = point.sub(this.stepDatas[0].point!);
        return Matrix4.createTranslation(x, y, z);
    }
}
