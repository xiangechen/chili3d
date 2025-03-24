// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Precision, XYZ, command } from "chili-core";
import { SphereNode } from "../../bodys";
import { SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.sphere",
    display: "command.sphere",
    icon: "icon-sphere",
})
export class Sphere extends CreateCommand {
    protected override getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let radiusStep = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusData);
        return [centerStep, radiusStep];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const point = this.stepDatas[0].point!;
        return {
            point: () => point,
            preview: this.previewSphere,
            plane: () => this.stepDatas[0].view.workplane.translateTo(point),
            validator: (p: XYZ) => p.distanceTo(point) > Precision.Distance,
        };
    };

    private readonly previewSphere = (end: XYZ | undefined) => {
        const centerVisual = this.previewPoint(this.stepDatas[0].point!);
        if (!end) {
            return [centerVisual];
        }

        const radius = this.stepDatas[0].point?.distanceTo(end)!;
        return [
            centerVisual,
            this.application.shapeFactory.circle(XYZ.unitZ, this.stepDatas[0].point!, radius).value.mesh
                .edges!,
            this.application.shapeFactory.circle(XYZ.unitY, this.stepDatas[0].point!, radius).value.mesh
                .edges!,
        ];
    };

    protected override geometryNode(): GeometryNode {
        const radius = this.stepDatas[0].point!.distanceTo(this.stepDatas[1].point!);
        return new SphereNode(this.document, this.stepDatas[0].point!, radius);
    }
}
