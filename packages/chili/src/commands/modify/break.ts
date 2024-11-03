// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let curve = (this.stepDatas[0].shapes[0].shape as IEdge).curve();
            let point = this.stepDatas[1].point!;
            let parameter = curve.parameter(point, 1e-3);
            if (parameter === undefined) {
                return;
            }
            let curve2 = curve.trim(parameter, curve.lastParameter());
            curve.setTrim(curve.firstParameter(), parameter);
            let model = this.document.visual.context.getNode(this.stepDatas[0].shapes[0].owner)!;
            model.parent?.remove(model);
            (this.stepDatas[0].shapes[0].shape as IEdge).update(curve);

            let model1 = new EditableShapeNode(
                this.document,
                `${model.name}_1`,
                this.stepDatas[0].shapes[0].shape,
            );
            let model2 = new EditableShapeNode(this.document, `${model.name}_2`, curve2.makeEdge());
            this.document.addNode(model1, model2);

            this.document.visual.update();
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Edge, "prompt.select.edges", false),
            new PointOnCurveStep("operate.pickFistPoint", () => {
                return {
                    curve: (this.stepDatas[0].shapes[0].shape as IEdge).curve(),
                    dimension: Dimension.D1,
                    preview: (point: XYZ | undefined) => {
                        if (!point) return [];
                        let curve = (this.stepDatas[0].shapes[0].shape as IEdge).curve();
                        let project = curve.project(point).at(0);

                        return [this.previewPoint(project ?? point)];
                    },
                };
            }),
        ];
    }
}
