// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    EditableGeometryEntity,
    GeometryEntity,
    ShapeMeshData,
    XYZ,
    command,
} from "chili-core";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.bezier",
    display: "command.bezier",
    icon: "icon-bezier",
})
export class BezierCommand extends CreateCommand {
    protected override geometryEntity(): GeometryEntity {
        let bezier = this.application.shapeFactory.bezier(this.stepDatas.map((x) => x.point!));
        return new EditableGeometryEntity(this.document, bezier.unwrap());
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
        }
    }

    protected override getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getNextData);
        return [firstStep, secondStep];
    }

    private getNextData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas.at(-1)!.point!,
            dimension: Dimension.D1D2D3,
            validators: [this.validator],
            preview: this.preview,
        };
    };

    private preview = (point: XYZ | undefined): ShapeMeshData[] => {
        let ps: ShapeMeshData[] = this.stepDatas.map((data) => this.previewPoint(data.point!));
        let points = this.stepDatas.map((data) => data.point) as XYZ[];
        if (point) {
            points.push(point);
        }
        if (points.length > 1) {
            ps.push(...this.previewLines(points));
            let bezier = this.application.shapeFactory.bezier(points);
            ps.push(bezier.unwrap().mesh.edges!);
        }

        return ps;
    };

    private previewLines = (points: XYZ[]): ShapeMeshData[] => {
        if (points.length < 2) {
            return [];
        }
        let res: ShapeMeshData[] = [];
        for (let i = 1; i < points.length; i++) {
            res.push(this.previewLine(points[i - 1], points[i]));
        }
        return res;
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
