// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, IShape, Result, ShapeNode, command } from "chili-core";
import { BooleanNode } from "../bodys/boolean";
import { IStep, SelectShapeNodeStep } from "../step";
import { CreateCommand } from "./createCommand";

export abstract class BooleanOperate extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        const shape1 = (this.stepDatas[0].nodes?.[0] as ShapeNode)?.shape.value;
        const shape2 = (this.stepDatas[1].nodes?.[0] as ShapeNode)?.shape.value;
        const booleanType = this.getBooleanOperateType();

        const booleanShape = this.getBooleanShape(booleanType, shape1, shape2);
        const node = new BooleanNode(this.document, booleanShape.value);

        this.stepDatas.forEach((x) => x.nodes?.[0]?.parent?.remove(x.nodes[0]));
        return node;
    }

    private getBooleanShape(
        type: "common" | "cut" | "fuse",
        shape1: IShape,
        shape2: IShape,
    ): Result<IShape> {
        switch (type) {
            case "common":
                return this.application.shapeFactory.booleanCommon(shape1, shape2);
            case "cut":
                return this.application.shapeFactory.booleanCut(shape1, shape2);
            default:
                return this.application.shapeFactory.booleanFuse(shape1, shape2);
        }
    }

    protected abstract getBooleanOperateType(): "common" | "cut" | "fuse";

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeNodeStep("prompt.select.shape"),
            new SelectShapeNodeStep("prompt.select.shape", {
                filter: {
                    allow: (shape) => {
                        return !this.stepDatas[0].nodes
                            ?.map((x) => (x as ShapeNode).shape.value)
                            .includes(shape);
                    },
                },
                keepSelection: true,
            }),
        ];
    }
}

@command({
    name: "boolean.common",
    display: "command.boolean.common",
    icon: "icon-booleanCommon",
})
export class BooleanCommon extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "common";
    }
}

@command({
    name: "boolean.cut",
    display: "command.boolean.cut",
    icon: "icon-booleanCut",
})
export class BooleanCut extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "cut";
    }
}

@command({
    name: "boolean.fuse",
    display: "command.boolean.fuse",
    icon: "icon-booleanFuse",
})
export class BooleanFuse extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "fuse";
    }
}
