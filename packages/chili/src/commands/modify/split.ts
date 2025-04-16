// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    GeometryNode,
    IEdge,
    IVisualGeometry,
    Result,
    ShapeType,
    Transaction,
    VisualState,
    command,
} from "chili-core";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "modify.split",
    display: "command.split",
    icon: "icon-split",
})
export class Split extends MultistepCommand {
    private splitedShape() {
        const shape1 = this.stepDatas[0].shapes[0].shape;
        const edges = this.stepDatas[1].shapes.map((x) => x.shape) as IEdge[];
        return shape1.split(edges);
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const old = this.document.visual.context.getNode(this.stepDatas[0].shapes[0].owner)!;
            const shape = this.splitedShape();

            if (old instanceof EditableShapeNode) {
                old.shape = Result.ok(shape);
            } else if (old instanceof GeometryNode) {
                const model = new EditableShapeNode(this.document, old.name, shape);
                model.transform = old.transform;
                this.removeModels(
                    this.stepDatas[0].shapes[0].owner,
                    ...this.stepDatas[1].shapes.map((x) => x.owner),
                );
                this.document.addNode(model);
            }

            this.document.visual.update();
        });
    }

    private removeModels(...shapes: IVisualGeometry[]) {
        shapes.forEach((x) => {
            const model = this.document.visual.context.getNode(x);
            model?.parent?.remove(model);
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", {
                selectedState: VisualState.faceTransparent,
            }),
            new SelectShapeStep(ShapeType.Wire | ShapeType.Edge, "prompt.select.shape", {
                multiple: true,
                keepSelection: true,
            }),
        ];
    }
}
