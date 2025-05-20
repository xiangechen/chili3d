// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    GeometryNode,
    IEdge,
    IVisualObject,
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
    key: "modify.split",
    icon: "icon-split",
})
export class Split extends MultistepCommand {
    private splitedShape() {
        const shape1 = this.transformdFirstShape(this.stepDatas[0]);
        const edges = this.stepDatas[1].shapes.map((x) =>
            x.shape.transformed(x.owner.totalTransform),
        ) as IEdge[];
        const result = shape1.split(edges);

        edges.forEach((x) => x.dispose());

        return result;
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const old = this.document.visual.context.getNode(this.stepDatas[0].shapes[0].owner)!;
            const shape = this.splitedShape();

            if (old instanceof EditableShapeNode) {
                old.shape = Result.ok(shape);
            } else if (old instanceof GeometryNode) {
                const model = new EditableShapeNode(this.document, old.name, shape);
                this.removeModels(
                    this.stepDatas[0].shapes[0].owner,
                    ...this.stepDatas[1].shapes.map((x) => x.owner),
                );
                this.document.addNode(model);
            }

            this.document.visual.update();
        });
    }

    private removeModels(...shapes: IVisualObject[]) {
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
