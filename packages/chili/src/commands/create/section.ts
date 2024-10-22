// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { EditableShapeNode, GeometryNode, I18n, ShapeType, command } from "chili-core";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.section",
    display: "command.section",
    icon: "icon-section",
})
export class Section extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        let shape = this.stepDatas[0].shapes[0].shape;
        let path = this.stepDatas[1].shapes[0].shape;
        let section = shape.section(path);
        return new EditableShapeNode(this.document, I18n.translate("command.section"), section);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", false),
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", false),
        ];
    }
}
