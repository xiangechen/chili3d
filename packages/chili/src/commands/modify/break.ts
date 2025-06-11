// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    IEdge,
    ITrimmedCurve,
    ShapeNode,
    ShapeType,
    Transaction,
    XYZ,
    command,
} from "chili-core";
import { Dimension } from "../../snap";
import { IStep, PointOnCurveStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "modify.break",
    icon: "icon-break",
})
export class Break extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const shape = this.stepDatas[0].shapes[0].shape as IEdge;
            const curve = shape.curve;
            const point = this.stepDatas[0].shapes[0].owner.node
                .worldTransform()
                .invert()!
                .ofPoint(this.stepDatas[1].point!);
            const parameter = curve.parameter(point, 1e-3);
            if (parameter === undefined) return;

            const curve2 = curve.trim(parameter, curve.lastParameter());
            curve.setTrim(curve.firstParameter(), parameter);
            shape.update(curve);

            const model = this.stepDatas[0].nodes![0] as ShapeNode;
            const model1 = new EditableShapeNode(this.document, `${model.name}_1`, shape);
            const model2 = new EditableShapeNode(this.document, `${model.name}_2`, curve2.makeEdge());
            model1.transform = model.transform;
            model2.transform = model.transform;
            model.parent?.insertAfter(model, model1);
            model.parent?.insertAfter(model1, model2);
            model.parent?.remove(model);

            this.document.visual.update();
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.edges", {
                shapeFilter: { allow: (s) => s.shapeType === ShapeType.Edge },
            }),
            new PointOnCurveStep("prompt.pickFistPoint", this.handlePointData, true),
        ];
    }

    private readonly handlePointData = () => {
        const edge = this.stepDatas[0].shapes[0].shape as IEdge;
        const curve = edge.curve.transformed(
            edge.matrix.multiply(this.stepDatas[0].shapes[0].transform),
        ) as ITrimmedCurve;
        this.disposeStack.add(curve);

        return {
            curve,
            dimension: Dimension.D1,
            preview: (point: XYZ | undefined) => {
                if (!point) return [];
                let project = curve.project(point).at(0);
                return [this.meshPoint(project ?? point)];
            },
        };
    };
}
