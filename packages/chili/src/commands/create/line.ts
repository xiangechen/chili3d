// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Precision, Property, XYZ, command } from "chili-core";
import { LineNode } from "../../bodys";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.line",
    display: "command.line",
    icon: "icon-line",
})
export class Line extends CreateCommand {
    @Property.define("command.line.isConnected", {
        dependencies: [{ property: "repeatOperation", value: true }],
    })
    get isContinue() {
        return this.getPrivateValue("isContinue", false);
    }
    set isContinue(value: boolean) {
        this.setProperty("isContinue", value);
    }

    protected override geometryNode(): GeometryNode {
        return new LineNode(this.document, this.stepDatas[0].point!, this.stepDatas[1].point!);
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    protected override resetSteps() {
        if (this.isContinue) {
            this.stepDatas[0] = this.stepDatas[1];
            this.stepDatas.length = 1;
        } else {
            this.stepDatas.length = 0;
        }
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            validators: [
                (point: XYZ) => {
                    return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
                },
            ],
            preview: this.linePreview,
        };
    };

    private readonly linePreview = (point: XYZ | undefined) => {
        let p1 = this.previewPoint(this.stepDatas[0].point!);
        if (!point) {
            return [p1];
        }
        return [p1, this.application.shapeFactory.line(this.stepDatas[0].point!, point).value.mesh.edges!];
    };
}
