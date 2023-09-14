// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryModel, IEdge, ILine, ShapeType, command } from "chili-core";
import { RevolveBody } from "../../bodys";
import { IStep } from "../../step";
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
