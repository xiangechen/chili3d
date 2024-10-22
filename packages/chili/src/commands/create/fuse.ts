// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, IFace, Precision, ShapeType, command } from "chili-core";
import { PrismNode } from "../../bodys";
import { LengthAtAxisSnapData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "convert.fuse",
    display: "command.fuse",
    icon: "icon-circle",
})
export class Fuse extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        let shape = this.stepDatas[0].shapes[0].shape as IFace; // todo assert
        let [point, normal] = shape.normal(0, 0);
        let dist = this.stepDatas[1].point!.sub(point).dot(normal);
        return new PrismNode(this.document, shape, dist);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Face, "prompt.select.faces", false),
            new LengthAtAxisStep("operate.pickNextPoint", this.getLengthStepData),
        ];
    }

    private getLengthStepData = (): LengthAtAxisSnapData => {
        let shape = this.stepDatas[0].shapes[0].shape as IFace; // todo assert
        let [point, normal] = shape.normal(0, 0);
        return {
            point,
            direction: normal,
            preview: (p) => {
                if (!p) return [];
                let dist = p.sub(point).dot(normal);
                if (Math.abs(dist) < Precision.Float) return [];
                let vec = normal.multiply(dist);
                return [this.application.shapeFactory.prism(shape, vec).value.mesh.edges!];
            },
        };
    };
}
