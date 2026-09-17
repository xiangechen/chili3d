// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type GeometryNode,
    type INode,
    MultistepCommand,
    property,
    ShapeNode,
    type SnapResult,
    Transaction,
} from "@chili3d/core";

/**
 * Nodes whose whole shape was selected — the selected shape's type matches the
 * node's own shape type (e.g. an edge picked from an edge node). Sub-shape
 * picks (a face of a solid node) are excluded so their owner node is kept.
 */
export function selectedWholeShapeNodes(stepDatas: SnapResult[]): INode[] {
    const nodes = new Set<INode>();
    stepDatas.forEach((data) => {
        data.shapes.forEach((shapeData) => {
            const node = shapeData.owner.node;
            if (
                node instanceof ShapeNode &&
                node.shape.isOk &&
                node.shape.value.shapeType === shapeData.shape.shapeType
            ) {
                nodes.add(node);
            }
        });
    });
    return [...nodes];
}

export abstract class CreateCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.geometryNode();
            this.document.modelManager.addNode(node);
            this.afterNodeCreated();
            this.document.visual.update();
        });
    }

    protected afterNodeCreated(): void {}

    protected abstract geometryNode(): GeometryNode;
}

export abstract class CreateFromSelectionCommand extends CreateCommand {
    @property("option.command.deleteObjects")
    get deleteObjects() {
        return this.getPrivateValue("deleteObjects", true);
    }
    set deleteObjects(value: boolean) {
        this.setProperty("deleteObjects", value);
    }

    protected override afterNodeCreated(): void {
        if (this.deleteObjects) {
            selectedWholeShapeNodes(this.stepDatas).forEach((node) => {
                node.parent?.remove(node);
            });
        }
    }
}

export abstract class CreateNodeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.document.modelManager.addNode(this.getNode());
            this.document.visual.update();
        });
    }

    protected abstract getNode(): GeometryNode;
}

export abstract class CreateFaceableCommand extends CreateCommand {
    @property("option.command.isFace")
    public get isFace() {
        return this.getPrivateValue("isFace", true);
    }
    public set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
