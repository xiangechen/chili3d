// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, IEdge, IFace, ILine, Precision, Property, ShapeType, command } from "chili-core";
import { PrismBody, RevolveBody } from "../../bodys";
import { SnapLengthAtAxisData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { SelectStep } from "../../step/selectStep";
import { CreateCommand } from "./createCommand";

let count = 1;

@command({
    name: "convert.revol",
    display: "command.revol",
    icon: "icon-circle",
})
export class Revolve extends CreateCommand {
    private _angle: number = 360;
    // @Property.define("common.angle")
    // public get angle() {
    //     return this._angle;
    // }
    // public set angle(value: number) {
    //     this.setProperty("angle", value);
    // }

    protected override create(): GeometryModel {
        let shape = this.stepDatas[0].shapes[0].shape; // todo assert
        let edge = (this.stepDatas[1].shapes[0].shape as IEdge).asCurve().getValue() as ILine;
        let body = new RevolveBody(this.document, shape, edge, this._angle);
        return new GeometryModel(this.document, `Revolve ${count++}`, body);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectStep(ShapeType.Shape, "prompt.select.shape", false),
            new SelectStep(ShapeType.Edge, "prompt.select.edges", false),
        ];
    }
}
