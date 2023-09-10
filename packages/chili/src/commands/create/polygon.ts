// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    AsyncController,
    EdgeMeshDataBuilder,
    GeometryModel,
    I18n,
    Precision,
    ShapeMeshData,
    XYZ,
    command,
} from "chili-core";
import { PolygonBody } from "../../bodys";
import { Dimension, SnapPointData, SnapedData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateFaceableCommand } from "./createCommand";

@command({
    name: "create.polygon",
    display: "command.polygon",
    icon: "icon-polygon",
})
export class Polygon extends CreateFaceableCommand {
    static count = 0;

    protected override create(): GeometryModel {
        let body = new PolygonBody(this.document, ...this.stepDatas.map((step) => step.point!));
        body.isFace = this.isFace;
        return new GeometryModel(this.document, `Polygon ${Polygon.count++}`, body);
    }

    protected override async executeSteps(startIndex: number): Promise<boolean> {
        this.stepDatas.length = startIndex;
        let steps = this.getSteps();
        let i = startIndex;
        while (true) {
            let step = i === 0 ? steps[0] : steps[1];
            this.controller = new AsyncController();
            let data = await step.execute(this.document, this.controller);
            if (data === undefined) break;
            this.stepDatas.push(data);
            if (this.isClose(data)) break;
            i++;
        }

        return this._restarting === false;
    }

    private isClose(data: SnapedData) {
        return (
            this.stepDatas.length > 1 && this.stepDatas[0].point!.distanceTo(data.point!) <= Precision.Length
        );
    }

    protected override getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getNextData);
        return [firstStep, secondStep];
    }

    private getNextData = (): SnapPointData => {
        return {
            refPoint: this.stepDatas.at(-1)!.point!,
            dimension: Dimension.D1D2D3,
            validators: [this.validator],
            preview: this.preview,
            featurePoints: [
                {
                    point: this.stepDatas.at(0)!.point!,
                    prompt: I18n.translate("prompt.polygon.close"),
                    when: () => this.stepDatas.length > 2,
                },
            ],
        };
    };

    private preview = (point: XYZ): ShapeMeshData[] => {
        let edges = new EdgeMeshDataBuilder();
        this.stepDatas.forEach((data) => edges.addPosition(data.point!.x, data.point!.y, data.point!.z));
        edges.addPosition(point.x, point.y, point.z);
        return [edges.build()];
    };

    private validator = (point: XYZ): boolean => {
        for (const data of this.stepDatas) {
            if (point.distanceTo(data.point!) < 0.001) {
                return false;
            }
        }
        return true;
    };
}
