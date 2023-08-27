// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    AsyncController,
    Colors,
    EdgeMeshData,
    EdgeMeshDataBuilder,
    GeometryModel,
    LineType,
    MessageType,
    Precision,
    PubSub,
    ShapeMeshData,
    VertexMeshData,
    XYZ,
    command,
} from "chili-core";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "./createCommand";
import { Dimension, SnapPointData } from "../../snap";
import { PolygonBody } from "../../bodys";

@command({
    name: "create.polygon",
    display: "command.polygon",
    icon: "icon-polygon",
})
export class Polygon extends CreateCommand {
    static count = 0;

    protected override create(): GeometryModel {
        let body = new PolygonBody(this.document, ...this.stepDatas.map((step) => step.point));
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
            if (data === undefined) {
                break;
            }
            this.stepDatas.push(data);
            i++;
        }

        return this._restarting === false;
    }

    protected override getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getNextData);
        return [firstStep, secondStep];
    }

    private getNextData = (): SnapPointData => {
        return {
            refPoint: this.stepDatas.at(-1)!.point,
            dimension: Dimension.D1D2D3,
            validators: [this.validator],
            preview: this.preview,
        };
    };

    private preview = (point: XYZ): ShapeMeshData[] => {
        let first = this.stepDatas.at(0)?.point;
        if (first && point.distanceTo(first) < 5) {
            point = first;
            console.log("todo");
        }
        let edges = new EdgeMeshDataBuilder();
        this.stepDatas.forEach((data) => edges.addPosition(data.point.x, data.point.y, data.point.z));
        edges.addPosition(point.x, point.y, point.z);
        return [edges.build()];
    };

    private validator = (point: XYZ): boolean => {
        for (const data of this.stepDatas) {
            if (point.distanceTo(data.point) < 0.001) {
                return false;
            }
        }
        return true;
    };
}
