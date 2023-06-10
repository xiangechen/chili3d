// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, IDocument, injectable, GeometryModel, Plane, XYZ, Application } from "chili-core";
import { CircleBody } from "../../bodys";
import { SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "./createCommand";

@injectable()
@command({
    name: "Circle",
    display: "command.circle",
    icon: "icon-circle",
})
export class Circle extends CreateCommand {
    private static count: number = 1;
    constructor() {
        super();
    }

    getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let radiusStep = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusData);
        return [centerStep, radiusStep];
    }

    private getRadiusData = (): SnapLengthAtPlaneData => {
        let point = this.stepDatas[0].point;
        return {
            point,
            preview: this.circlePreview,
            plane: this.stepDatas[0].view.workplane.copyTo(point),
        };
    };

    create(document: IDocument): GeometryModel {
        let [p1, p2] = [this.stepDatas[0].point, this.stepDatas[1].point];
        let plane = this.stepDatas[0].view.workplane;
        let body = new CircleBody(document, plane.normal, p1, this.getDistanceAtPlane(plane, p1, p2));
        return new GeometryModel(document, `Circle ${Circle.count++}`, body);
    }

    private circlePreview = (point: XYZ) => {
        let start = this.stepDatas[0].point;
        let plane = this.stepDatas[0].view.workplane;
        return Application.instance.shapeFactory
            .circle(plane.normal, start, this.getDistanceAtPlane(plane, start, point))
            .value?.mesh().edges;
    };

    private getDistanceAtPlane(plane: Plane, p1: XYZ, p2: XYZ) {
        let dp1 = plane.project(p1);
        let dp2 = plane.project(p2);
        return dp1.distanceTo(dp2);
    }
}
