// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { EditableShapeNode, I18n, Property, ShapeType, command } from "chili-core";
import { IStep, SelectShapeStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.thickSolid",
    display: "command.thickSolid",
    icon: "icon-thickSolid",
})
export class ThickSolidCommand extends CreateCommand {
    @Property.define("command.thickSolid")
    get thickness() {
        return this.getPrivateValue("thickness", 10);
    }
    set thickness(value: number) {
        this.setProperty("thickness", value);
    }

    protected override geometryNode() {
        let shape = this.stepDatas[0].shapes[0].shape;
        let thickSolid = this.application.shapeFactory.makeThickSolidBySimple(shape, this.thickness);
        return new EditableShapeNode(this.document, I18n.translate("command.thickSolid"), thickSolid.value);
    }

    protected override getSteps(): IStep[] {
        return [new SelectShapeStep(ShapeType.Shape, "prompt.select.shape")];
    }
}
