// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    EdgeMeshDataBuilder,
    GeometryNode,
    I18n,
    Precision,
    ShapeMeshData,
    XYZ,
    command,
} from "chili-core";
import { PolygonNode } from "../../bodys";
import { Dimension, PointSnapData, SnapedData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateFaceableCommand } from "../createCommand";

@command({
    name: "create.polygon",
    display: "command.polygon",
    icon: "icon-polygon",
})
export class Polygon extends CreateFaceableCommand {
    protected override geometryNode(): GeometryNode {
        let node = new PolygonNode(
            this.document,
            this.stepDatas.map((step) => step.point!),
        );
        node.isFace = this.isFace;
        return node;
    }

    protected override async executeSteps(): Promise<boolean> {
        let steps = this.getSteps();
        let firstStep = true;
        while (true) {
            let step = firstStep ? steps[0] : steps[1];
            if (firstStep) firstStep = false;
            this.controller = new AsyncController();
            let data = await step.execute(this.document, this.controller);
            if (data === undefined) {
                return this.controller.result?.status === "success";
            }
            this.stepDatas.push(data);
            if (this.isClose(data)) {
                return true;
            }
        }
    }

    private isClose(data: SnapedData) {
        return (
            this.stepDatas.length > 1 &&
            this.stepDatas[0].point!.distanceTo(data.point!) <= Precision.Distance
        );
    }

    protected override getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getNextData);
        return [firstStep, secondStep];
    }

    private readonly getNextData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas.at(-1)!.point!,
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

    private preview = (point: XYZ | undefined): ShapeMeshData[] => {
        let ps = this.stepDatas.map((data) => this.previewPoint(data.point!));
        let edges = new EdgeMeshDataBuilder();
        this.stepDatas.forEach((data) => edges.addPosition(data.point!.x, data.point!.y, data.point!.z));
        if (point) {
            edges.addPosition(point.x, point.y, point.z);
        }
        return [...ps, edges.build()];
    };

    private readonly validator = (point: XYZ): boolean => {
        for (const data of this.stepDatas) {
            if (point.distanceTo(data.point!) < 0.001) {
                return false;
            }
        }
        return true;
    };
}
