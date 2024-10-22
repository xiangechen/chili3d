// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    GeometryNode,
    ICurve,
    IEdge,
    ILine,
    IShape,
    IShapeFilter,
    Property,
    Ray,
    ShapeType,
    command,
} from "chili-core";
import { RevolvedNode } from "../../bodys";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "convert.revol",
    display: "command.revol",
    icon: "icon-revolve",
})
export class Revolve extends CreateCommand {
    @Property.define("common.angle")
    public get angle() {
        return this.getPrivateValue("angle", 360);
    }
    public set angle(value: number) {
        this.setProperty("angle", value);
    }

    protected override geometryNode(): GeometryNode {
        let shape = this.stepDatas[0].shapes[0].shape; // todo assert
        let edge = (this.stepDatas[1].shapes[0].shape as IEdge).curve().basisCurve() as ILine;
        let axis = new Ray(edge.value(0), edge.direction);
        return new RevolvedNode(this.document, shape, axis, this.angle);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                ShapeType.Edge | ShapeType.Face | ShapeType.Wire,
                "prompt.select.shape",
                false,
            ),
            new SelectShapeStep(ShapeType.Edge, "prompt.select.edges", false, new LineFilter()),
        ];
    }
}

class LineFilter implements IShapeFilter {
    allow(shape: IShape): boolean {
        if (shape.shapeType === ShapeType.Edge) {
            let edge = shape as IEdge;
            let curve = edge.curve().basisCurve();
            return ICurve.isLine(curve);
        }
        return false;
    }
}
