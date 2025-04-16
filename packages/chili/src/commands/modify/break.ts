// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, IEdge, ShapeType, Transaction, XYZ, command } from "chili-core";
import { Dimension } from "../../snap";
import { IStep, PointOnCurveStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "modify.break",
    display: "command.break",
    icon: "icon-break",
})
export class Break extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const shape = this.stepDatas[0].shapes[0].shape as IEdge;
            const curve = shape.curve();
            const point = this.stepDatas[1].point!;
            const parameter = curve.parameter(point, 1e-3);
            if (parameter === undefined) return;

            const curve2 = curve.trim(parameter, curve.lastParameter());
            curve.setTrim(curve.firstParameter(), parameter);

            const model = this.document.visual.context.getNode(this.stepDatas[0].shapes[0].owner)!;
            model.parent?.remove(model);
            shape.update(curve);

            const model1 = new EditableShapeNode(this.document, `${model.name}_1`, shape);
            const model2 = new EditableShapeNode(this.document, `${model.name}_2`, curve2.makeEdge());
            this.document.addNode(model1, model2);
            this.document.visual.update();
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Edge, "prompt.select.edges"),
            new PointOnCurveStep(
                "operate.pickFistPoint",
                () => {
                    return {
                        curve: (this.stepDatas[0].shapes[0].shape as IEdge).curve(),
                        dimension: Dimension.D1,
                        preview: (point: XYZ | undefined) => {
                            if (!point) return [];
                            const curve = (this.stepDatas[0].shapes[0].shape as IEdge).curve();
                            const project = curve.project(point).at(0);

                            return [this.meshPoint(project ?? point)];
                        },
                    };
                },
                true,
            ),
        ];
    }
}
