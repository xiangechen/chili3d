// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, GeometryNode, ISubFaceShape, Property, ShapeType, Transaction } from "chili-core";
import { IStep, SelectNodeStep, SelectShapeStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "modify.brushAdd",
    icon: "icon-addBrush",
})
export class AddBrushCommand extends MultistepCommand {
    @Property.define("common.material", { type: "materialId" })
    get materialId(): string {
        return this.getPrivateValue("materialId", this.document.materials.at(0)?.id);
    }
    set materialId(value: string) {
        this.setProperty("materialId", value);
    }

    protected override getSteps(): IStep[] {
        return [new SelectShapeStep(ShapeType.Face, "prompt.select.faces", { multiple: true })];
    }
    protected override executeMainTask(): void {
        const nodeMatiralMape = new Map<GeometryNode, { faceIndex: number; materialId: string }[]>();

        this.stepDatas[0].shapes.forEach((x) => {
            if (x.owner.node instanceof GeometryNode) {
                if (!nodeMatiralMape.has(x.owner.node)) {
                    nodeMatiralMape.set(x.owner.node, []);
                }
                nodeMatiralMape.get(x.owner.node)!.push({
                    faceIndex: (x.shape as ISubFaceShape).index,
                    materialId: this.materialId,
                });
            }
        });

        Transaction.execute(this.document, "add face material", () => {
            nodeMatiralMape.forEach((value, key) => {
                key.addFaceMaterial(value);
            });
        });

        this.document.visual.update();
    }
}

@command({
    key: "modify.brushRemove",
    icon: "icon-removeBrush",
})
export class RemoveBrushCommand extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [new SelectShapeStep(ShapeType.Face, "prompt.select.faces", { multiple: true })];
    }

    protected override executeMainTask(): void {
        const nodeMatiralMape = new Map<GeometryNode, number[]>();

        this.stepDatas[0].shapes.forEach((x) => {
            if (x.owner.node instanceof GeometryNode) {
                if (!nodeMatiralMape.has(x.owner.node)) {
                    nodeMatiralMape.set(x.owner.node, []);
                }
                nodeMatiralMape.get(x.owner.node)!.push((x.shape as ISubFaceShape).index);
            }
        });

        Transaction.execute(this.document, "remove face material", () => {
            nodeMatiralMape.forEach((value, key) => {
                key.removeFaceMaterial(value);
            });
        });

        this.document.visual.update();
    }
}

@command({
    key: "modify.brushClear",
    icon: "icon-clearBrush",
})
export class ClearBrushCommand extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [new SelectNodeStep("prompt.select.shape", { multiple: true, keepSelection: true })];
    }

    protected override executeMainTask(): void {
        Transaction.execute(this.document, "clear face material", () => {
            this.stepDatas[0].nodes?.forEach((x) => {
                if (x instanceof GeometryNode) {
                    x.clearFaceMaterial();
                }
            });
        });

        this.document.visual.update();
    }
}
