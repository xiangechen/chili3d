// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, I18n, Property, PubSub, ShapeType, Transaction, command } from "chili-core";
import { IStep, SelectShapeStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "create.thickSolid",
    icon: "icon-thickSolid",
})
export class ThickSolidCommand extends MultistepCommand {
    @Property.define("option.command.thickness")
    get thickness() {
        return this.getPrivateValue("thickness", 10);
    }
    set thickness(value: number) {
        this.setProperty("thickness", value);
    }

    protected override executeMainTask(): void {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stepDatas[0].shapes.forEach((x) => {
                const subShape = this.application.shapeFactory.makeThickSolidBySimple(
                    x.shape,
                    this.thickness,
                );
                if (!subShape.isOk) {
                    PubSub.default.pub("showToast", "toast.converter.error");
                    return;
                }
                const model = new EditableShapeNode(
                    this.document,
                    I18n.translate("command.create.thickSolid"),
                    subShape,
                );

                const node = x.owner.node;
                model.transform = node.transform;
                node.parent!.insertAfter(node, model);
            });
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    protected override getSteps(): IStep[] {
        return [new SelectShapeStep(ShapeType.Face, "prompt.select.faces", { multiple: true })];
    }
}
