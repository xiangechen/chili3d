// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    IEdge,
    IVisualObject,
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
        const shape1 = this.stepDatas[0].shapes[0].shape;
        const invertTransform = this.stepDatas[0].shapes[0].transform.invert()!;
        const edges = this.stepDatas[1].shapes.map((x) =>
            x.shape.transformedMul(x.transform.multiply(invertTransform)),
        ) as IEdge[];
        const result = shape1.split(edges);

        edges.forEach((x) => x.dispose());

        return result;
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const old = this.stepDatas[0].nodes![0];
            const shape = this.splitedShape();

            const model = new EditableShapeNode(this.document, old.name, shape);
            model.transform = old.transform;
            old.parent?.add(model);

            this.removeModels(
                this.stepDatas[0].shapes[0].owner,
                ...this.stepDatas[1].shapes.map((x) => x.owner),
            );
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
