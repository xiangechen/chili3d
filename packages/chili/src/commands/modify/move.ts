// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Config, IDocument, IModel, INode, LineType, Matrix4, Transaction, XYZ, command } from "chili-core";
import { Dimension, SnapPointData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "Move",
    display: "command.move",
    icon: "icon-line",
})
export class Move extends MultistepCommand {
    private models?: IModel[];
    private positions?: number[];

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

    private movePreview = (point: XYZ) => {
        let start = this.stepDatas[0].point;
        let positions = [...this.positions!];
        let { x, y, z } = point.sub(start);
        for (let i = 0; i < this.positions!.length; i++) {
            if (i % 3 === 0) positions[i] += x;
            else if (i % 3 === 1) positions[i] += y;
            else if (i % 3 === 2) positions[i] += z;
        }
        positions.push(start.x, start.y, start.z, point.x, point.y, point.z);
        return [
            {
                positions,
                lineType: LineType.Solid,
                color: Config.instance.visual.temporaryEdgeColor,
                groups: [],
            },
        ];
    };

    protected override beforeExcute(document: IDocument): Promise<boolean> {
        this.models = document.selection.getSelectedNodes().filter((x) => INode.isModelNode(x)) as IModel[];
        this.positions = [];
        this.models?.forEach((model) => {
            let ps = model.shape()?.mesh.edges?.positions;
            if (ps) this.positions = this.positions!.concat(model.matrix.ofPoints(ps));
        });
        return Promise.resolve(this.models.length > 0);
    }

    protected excuting(document: IDocument): void {
        Transaction.excute(document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let vec = this.stepDatas[1].point.sub(this.stepDatas[0].point);
            let transform = Matrix4.translationTransform(vec.x, vec.y, vec.z);
            this.models?.forEach((x) => {
                x.matrix = x.matrix.multiply(transform);
            });
            document.visual.viewer.redraw();
        });
    }
}
