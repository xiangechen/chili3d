// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, GeometryNode, I18n, ShapeType, VisualState, command } from "chili-core";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    key: "create.section",
    icon: "icon-section",
})
export class Section extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        let shape = this.transformdFirstShape(this.stepDatas[0]);
        let path = this.transformdFirstShape(this.stepDatas[1]);
        let section = shape.section(path);
        return new EditableShapeNode(this.document, I18n.translate("command.create.section"), section);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", {
                selectedState: VisualState.faceTransparent,
            }),
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", { keepSelection: true }),
        ];
    }
}
