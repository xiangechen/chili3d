// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, EditableShapeNode, I18n, ShapeType, VisualState } from "chili-core";
import type { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "create.section",
    icon: "icon-section",
})
export class Section extends MultistepCommand {
    protected override executeMainTask() {
        const shape = this.transformdFirstShape(this.stepDatas[0]);
        const path = this.transformdFirstShape(this.stepDatas[1]);
        const section = shape.section(path);
        const node = new EditableShapeNode(this.document, I18n.translate("command.create.section"), section);
        this.document.modelManager.rootNode.add(node);
        this.document.visual.update();
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
