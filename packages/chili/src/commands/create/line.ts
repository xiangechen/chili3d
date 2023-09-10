// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, Precision, Property, XYZ, command } from "chili-core";
import { LineBody } from "../../bodys";
import { Dimension, SnapPointData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "./createCommand";

@command({
    name: "create.line",
    display: "command.line",
    icon: "icon-line",
})
export class Line extends CreateCommand {
    private static count: number = 1;

    private _isContinue: boolean = false;
    @Property.dependence("repeatOperation", true)
    @Property.define("command.line.isConnected")
    get isContinue() {
        return this._isContinue;
    }
    set isContinue(value: boolean) {
        this.setProperty("isContinue", value);
    }

    create(): GeometryModel {
        let body = new LineBody(this.document, this.stepDatas[0].point!, this.stepDatas[1].point!);
        return new GeometryModel(this.document, `Line ${Line.count++}`, body);
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    protected override async repeatCommand(): Promise<void> {
        if (this._isContinue) {
            this.stepDatas[0] = this.stepDatas[1];
            await this.executeFromStep(1);
        } else {
            await this.executeFromStep(0);
        }
    }

    private getSecondPointData = (): SnapPointData => {
        return {
            refPoint: this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            validators: [
                (point: XYZ) => {
                    return this.stepDatas[0].point!.distanceTo(point) > Precision.Length;
                },
            ],
            preview: this.linePreview,
        };
    };

    private linePreview = (point: XYZ) => {
        return [this.application.shapeFactory.line(this.stepDatas[0].point!, point).unwrap().mesh.edges!];
    };
}
