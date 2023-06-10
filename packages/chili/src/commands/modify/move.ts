// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IModel, INode, IShape, XYZ, command } from "chili-core";
import { MultistepCommand } from "../multistepCommand";
import { IStep, PointStep } from "../../step";
import { Dimension, SnapPointData } from "../../snap";

@command({
    name: "Move",
    display: "command.move",
    icon: "icon-line",
})
export class Move extends MultistepCommand {
    private models?: IModel[];

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private getSecondPointData = (): SnapPointData => {
        return {
            refPoint: this.stepDatas[0].point,
            dimension: Dimension.D1D2D3,
            preview: this.movePreview,
        };
    };

    private movePreview = (point: XYZ): IShape | undefined => {
        return;
    };

    protected override beforeExcute(document: IDocument): Promise<boolean> {
        this.models = document.selection.getSelectedNodes().filter((x) => INode.isModelNode(x)) as IModel[];
        return Promise.resolve(this.models.length > 0);
    }

    protected excuting(document: IDocument): void {
        this.models?.forEach((x) => {
            x.translation = this.stepDatas[1].point.sub(this.stepDatas[0].point);
        });
    }
}
