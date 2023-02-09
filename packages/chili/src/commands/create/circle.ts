// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, Id, IDocument, inject, injectable, IView, Model, Plane, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

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
    constructor(@inject(Token.ShapeFactory) private factory: IShapeFactory) {
        super();
    }

    getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let radiusStep = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusPointData);
        return [centerStep, radiusStep];
    }
    private getRadiusPointData = (): SnapLengthAtPlaneData => {
        let point = this.stepDatas[0].point;
        return {
            point,
            preview: this.circlePreview,
            plane: this.stepDatas[0].view.workplane.copyTo(point),
        };
    };

    create(document: IDocument): Model {
        let [p1, p2] = [this.stepDatas[0].point, this.stepDatas[1].point];
        let plane = this.stepDatas[0].view.workplane;
        let body = new CircleBody(plane.normal!, p1, this.getDistanceAtPlane(plane, p1, p2));
        return new Model(`Circle ${document.modelCount + 1}`, Id.new(), body);
    }

    private circlePreview = (view: IView, point: XYZ) => {
        let start = this.stepDatas[0].point;
        let plane = this.stepDatas[0].view.workplane;
        return this.factory.circle(plane.normal, start, this.getDistanceAtPlane(plane, start, point)).value;
    };

    private getDistanceAtPlane(plane: Plane, p1: XYZ, p2: XYZ) {
        let dp1 = plane.project(p1);
        let dp2 = plane.project(p2);
        return dp1.distanceTo(dp2);
    }
}
