// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { EditableGeometryEntity, GeometryEntity, Property, ShapeType, command } from "chili-core";
import { IStep, SelectShapeStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.thickSolid",
    display: "command.thickSolid",
    icon: "icon-thickSolid",
})
export class ThickSolidCommand extends CreateCommand {
    private _thickness: number = 50;
    @Property.define("command.thickSolid")
    get thickness() {
        return this._thickness;
    }
    set thickness(value: number) {
        this.setProperty("thickness", value);
    }

    protected override geometryEntity(): GeometryEntity {
        let shape = this.stepDatas[0].shapes[0].shape;
        let thickSolid = this.application.shapeFactory.makeThickSolidBySimple(shape, this.thickness);
        return new EditableGeometryEntity(this.document, thickSolid.unwrap());
    }

    protected override getSteps(): IStep[] {
        return [new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", false)];
    }
}
