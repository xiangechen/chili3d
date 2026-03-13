// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    type IEdge,
    type IStep,
    type IVisualObject,
    SelectShapeStep,
    type ShapeType,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
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
            const subShapes = shape.iterShape();
            if (subShapes.length > 1) {
                let i = 1;
                old.parent?.add(
                    ...subShapes.map((x) => {
                        const model = new EditableShapeNode({
                            document: this.document,
                            name: old.name + i++,
                            shape: x,
                        });
                        model.transform = old.transform;
                        return model;
                    }),
                );
            } else {
                const model = new EditableShapeNode({ document: this.document, name: old.name, shape });
                model.transform = old.transform;
                old.parent?.add(model);
            }

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
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                selectedState: VisualStates.faceTransparent,
            }),
            new SelectShapeStep(
                (ShapeTypes.edge | ShapeTypes.wire | ShapeTypes.face) as ShapeType,
                "prompt.select.shape",
                {
                    multiple: true,
                    keepSelection: true,
                },
            ),
        ];
    }
}
