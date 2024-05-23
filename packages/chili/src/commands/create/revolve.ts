// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    GeometryEntity,
    ICurve,
    IEdge,
    ILine,
    IShape,
    IShapeFilter,
    ParameterGeometryEntity,
    Property,
    Ray,
    ShapeType,
    command,
} from "chili-core";
import { RevolveBody } from "../../bodys";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "convert.revol",
    display: "command.revol",
    icon: "icon-revolve",
})
export class Revolve extends CreateCommand {
    private _angle: number = 360;
    @Property.define("common.angle")
    public get angle() {
        return this._angle;
    }
    public set angle(value: number) {
        this.setProperty("angle", value);
    }

    protected override geometryEntity(): GeometryEntity {
        let shape = this.stepDatas[0].shapes[0].shape; // todo assert
        let edge = (this.stepDatas[1].shapes[0].shape as IEdge).asCurve().basisCurve() as ILine;
        let axis = new Ray(edge.point(0), edge.direction);
        let body = new RevolveBody(this.document, shape, axis, this._angle);
        return new ParameterGeometryEntity(this.document, body);
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
            let curve = edge.asCurve();
            return ICurve.isLine(curve);
        }
        return false;
    }
}
