// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IShape, PubSub, Result, ShapeNode, ShapeType, Transaction, VisualState, command } from "chili-core";
import { BooleanNode } from "../bodys/boolean";
import { IStep, SelectShapeStep } from "../step";
import { MultistepCommand } from "./multistepCommand";

export abstract class BooleanOperate extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, "boolean", () => {
            const shape1 = this.transformdFirstShape(this.stepDatas[0]);
            const shape2 = this.transformdShapes(this.stepDatas[1]);
            const booleanType = this.getBooleanOperateType();

            const booleanShape = this.getBooleanShape(booleanType, shape1, shape2);
            if (!booleanShape.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", "boolean failed");
                return;
            }
            const node = new BooleanNode(this.document, booleanShape.value);
            this.document.rootNode.add(node);
            this.stepDatas.forEach((x) => {
                x.nodes?.forEach((n) => n.parent?.remove(n));
            });
            this.document.visual.update();
        });
    }

    private getBooleanShape(
        type: "common" | "cut" | "fuse",
        shape1: IShape,
        tools: IShape[],
    ): Result<IShape> {
        switch (type) {
            case "common":
                return this.application.shapeFactory.booleanCommon([shape1], tools);
            case "cut":
                return this.application.shapeFactory.booleanCut([shape1], tools);
            default:
                return this.application.shapeFactory.booleanFuse([shape1], tools);
        }
    }

    protected abstract getBooleanOperateType(): "common" | "cut" | "fuse";

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", {
                nodeFilter: { allow: (node) => node instanceof ShapeNode },
            }),
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", {
                nodeFilter: {
                    allow: (node) => {
                        if (!(node instanceof ShapeNode)) {
                            return false;
                        }

                        return !this.stepDatas[0].nodes
                            ?.map((x) => (x as ShapeNode).shape.value)
                            .includes(node.shape.value);
                    },
                },
                multiple: true,
                keepSelection: true,
                selectedState: VisualState.faceTransparent,
            }),
        ];
    }
}

@command({
    key: "boolean.common",
    icon: "icon-booleanCommon",
})
export class BooleanCommon extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "common";
    }
}

@command({
    key: "boolean.cut",
    icon: "icon-booleanCut",
})
export class BooleanCut extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "cut";
    }
}

@command({
    key: "boolean.join",
    icon: "icon-booleanFuse",
})
export class BooleanFuse extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "fuse";
    }
}
