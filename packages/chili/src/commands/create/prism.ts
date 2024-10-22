// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Precision, ShapeType, command } from "chili-core";
import { GeoUtils } from "chili-geo";
import { PrismNode } from "../../bodys";
import { LengthAtAxisSnapData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "convert.prism",
    display: "command.prism",
    icon: "icon-prism",
})
export class Prism extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        let shape = this.stepDatas[0].shapes[0].shape;
        const { point, normal } = this.getAxis();
        let dist = this.stepDatas[1].point!.sub(point).dot(normal);
        return new PrismNode(this.document, shape, dist);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                ShapeType.Face | ShapeType.Edge | ShapeType.Wire,
                "prompt.select.shape",
                false,
            ),
            new LengthAtAxisStep("operate.pickNextPoint", this.getLengthStepData),
        ];
    }

    private readonly getLengthStepData = (): LengthAtAxisSnapData => {
        const { point, normal } = this.getAxis();
        return {
            point,
            direction: normal,
            preview: (p) => {
                if (!p) return [];
                let dist = p.sub(point).dot(normal);
                if (Math.abs(dist) < Precision.Float) return [];
                let vec = normal.multiply(dist);
                let shape = this.stepDatas[0].shapes[0].shape;
                return [this.application.shapeFactory.prism(shape, vec).value.mesh.edges!];
            },
        };
    };

    private getAxis() {
        let point = this.stepDatas[0].shapes[0].point!;
        let shape = this.stepDatas[0].shapes[0].shape;
        let normal = GeoUtils.normal(shape as any);
        return { point, normal };
    }
}
