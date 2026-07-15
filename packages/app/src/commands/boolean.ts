// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    debounce,
    type IShape,
    type IStep,
    MultistepCommand,
    PubSub,
    property,
    type Result,
    SelectShapeStep,
    ShapeNode,
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import { BooleanNode } from "../bodys/boolean";

export abstract class BooleanOperate extends MultistepCommand {
    private tempVisual?: number;

    @property("common.keepTools")
    get keepTools() {
        return this.getPrivateValue("keepTools", false);
    }
    set keepTools(value: boolean) {
        this.setProperty("keepTools", value);
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, "boolean", () => {
            const booleanShape = this.booleanOperate(this.stepDatas[1].shapes);
            if (!booleanShape.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", "boolean failed");
                return;
            }
            const node = new BooleanNode({ document: this.document, booleanShape: booleanShape.value });
            this.document.modelManager.rootNode.add(node);
            if (this.keepTools) {
                this.stepDatas[0].nodes?.forEach((x) => x.parent?.remove(x));
            } else {
                this.stepDatas.forEach((x) => {
                    x.nodes?.forEach((n) => n.parent?.remove(n));
                });
            }
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
                return shapeFactory.booleanCommon([shape1], tools);
            case "cut":
                return shapeFactory.booleanCut([shape1], tools);
            default:
                return shapeFactory.booleanFuse([shape1], tools, true);
        }
    }

    protected abstract getBooleanOperateType(): "common" | "cut" | "fuse";

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                nodeFilter: { allow: (node) => node instanceof ShapeNode },
            }),
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
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
                beforeSelection: () => {
                    this.addFirstSelectedState(VisualStates.edgeSelected);
                    this.document.selection.onShapeChanged.sub(this.onToolsChanged);
                },
                afterSelection: () => {
                    this.removeFirstSelectedState(VisualStates.edgeSelected);
                    this.document.selection.onShapeChanged.remove(this.onToolsChanged);
                    if (this.tempVisual) {
                        this.document.visual.context.removeMesh(this.tempVisual);
                        this.tempVisual = undefined;
                    }
                    const nodeVisual = this.stepDatas.at(0)?.shapes.at(0)?.owner;
                    if (nodeVisual) {
                        nodeVisual.visible = true;
                    }
                },
                selectedState: VisualStates.faceTransparent,
            }),
        ];
    }

    private readonly onToolsChanged = debounce((selected: VisualShapeData[]) => {
        if (this.tempVisual) {
            this.document.visual.context.removeMesh(this.tempVisual);
            this.tempVisual = undefined;
        }
        const nodeVisual = this.stepDatas.at(0)?.shapes.at(0)?.owner;
        if (!nodeVisual) return;
        if (selected.length === 0) {
            nodeVisual.visible = true;
            return;
        }

        const booleanShape = this.booleanOperate(selected);
        if (!booleanShape.isOk) {
            nodeVisual.visible = true;
            PubSub.default.pub("showToast", "error.default:{0}", "boolean failed");
            return;
        }
        this.disposeStack.add(booleanShape.value);
        nodeVisual.visible = false;
        this.tempVisual = this.document.visual.context.displayMesh(
            [booleanShape.value.mesh.faces!, booleanShape.value.mesh.edges!].filter((x) => x !== undefined),
        );

        this.document.visual.update();
    }, 20);

    private booleanOperate(selected: VisualShapeData[]) {
        const shape1 = this.transformdFirstShape(this.stepDatas[0]);
        shape1.setTolerance(1e-6);
        const shape2 = selected.map((s) => {
            const shape = s.shape.transformedMul(s.transform);
            shape.setTolerance(1e-6);
            this.disposeStack.add(shape);
            return shape;
        });
        const booleanType = this.getBooleanOperateType();
        return this.getBooleanShape(booleanType, shape1, shape2);
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
