// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    GeometryNode,
    LineType,
    Matrix4,
    Transaction,
    VisualConfig,
    VisualNode,
    XYZ,
    command,
} from "chili-core";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "modify.array",
    display: "command.array",
    icon: "icon-array",
})
export class Array extends MultistepCommand {
    private models?: VisualNode[];
    private positions?: number[];

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            preview: this.movePreview,
        };
    };

    private readonly movePreview = (point: XYZ | undefined) => {
        let p1 = this.previewPoint(this.stepDatas[0].point!);
        if (!point) return [p1];
        let start = this.stepDatas[0].point!;
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
                color: VisualConfig.temporaryEdgeColor,
                groups: [],
            },
        ];
    };

    protected override async beforeExecute(): Promise<boolean> {
        this.models = this.document.selection.getSelectedNodes().filter((x) => x instanceof GeometryNode);
        if (this.models.length === 0) {
            this.controller = new AsyncController();
            this.models = await this.document.selection.pickNode("axis.x", this.controller, true);
            if (this.models.length === 0) return false;
        }
        this.positions = [];
        this.models?.forEach((model) => {});
        return true;
    }

    protected executeMainTask(): void {
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let vec = this.stepDatas[1].point!.sub(this.stepDatas[0].point!);
            let transform = Matrix4.createTranslation(vec.x, vec.y, vec.z);
            this.models?.forEach((x) => {
                x.transform = x.transform.multiply(transform);
            });
            this.document.visual.update();
        });
    }
}
