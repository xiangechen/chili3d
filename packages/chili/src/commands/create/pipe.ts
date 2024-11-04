// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, EdgeMeshDataBuilder, Property, ShapeMeshData, XYZ, command } from "chili-core";
import { PipeNode } from "../../bodys";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.pipe",
    display: "command.pipe",
    icon: "icon-pipe",
})
export class Pipe extends CreateCommand {
    @Property.define("pipe.outsideDiameter")
    get outsideDiameter() {
        return this.getPrivateValue("outsideDiameter", 10);
    }
    set outsideDiameter(value: number) {
        this.setProperty("outsideDiameter", value);
    }

    @Property.define("pipe.wallThickness")
    get wallThickness() {
        return this.getPrivateValue("wallThickness", 1);
    }
    set wallThickness(value: number) {
        this.setProperty("wallThickness", value);
    }

    @Property.define("pipe.bendingRadius")
    get bendingRadius() {
        return this.getPrivateValue("bendingRadius", 10);
    }
    set bendingRadius(value: number) {
        this.setProperty("bendingRadius", value);
    }

    protected override geometryNode(): PipeNode {
        console.log("Pipe create command");
        return new PipeNode(
            this.document,
            this.outsideDiameter,
            this.wallThickness,
            this.bendingRadius,
            this.stepDatas.map((x) => x.point!),
        );
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
            console.log("push step data");
        }
    }

    protected override getSteps(): IStep[] {
        console.error("get steps");
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
