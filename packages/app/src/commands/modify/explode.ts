// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ComponentNode,
    command,
    EditableShapeNode,
    GetOrSelectNodeStep,
    GroupNode,
    type IShape,
    type IStep,
    instanceSourcesInUse,
    MultiShapeNode,
    MultistepCommand,
    PubSub,
    ShapeNode,
    ShapeTypeUtils,
    Transaction,
} from "@chili3d/core";

@command({
    key: "modify.explode",
    icon: "icon-explode",
})
export class Explode extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [new GetOrSelectNodeStep("prompt.select.shape", { multiple: true })];
    }

    protected override executeMainTask() {
        this.document.selection.clearSelection();

        // The exploded node is replaced by several pieces; its instances have no single
        // successor, so refuse while one still reads it.
        const removed = this.stepDatas[0].nodes ?? [];
        if (instanceSourcesInUse(this.document, removed).size > 0) {
            PubSub.default.pub("showToast", "toast.instance.sourceInUse");
            return;
        }

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stepDatas[0].nodes?.forEach((x) => {
                if (x instanceof ShapeNode) {
                    this.explodeShapeNode(x);
                } else if (x instanceof ComponentNode) {
                    this.explodeComponentNode(x);
                } else if (x instanceof MultiShapeNode) {
                    this.explodeMultiShapeNode(x);
                }
            });
        });

        this.document.visual.update();
    }

    private explodeShapeNode(x: ShapeNode) {
        const subShapes = x.shape.value.directSubShapes();
        if (subShapes.length === 1) {
            const subShapeNode = new EditableShapeNode({
                document: this.document,
                name: x.name,
                shape: subShapes[0],
                materialId: x.materialId,
            });
            subShapeNode.transform = x.transform;
            x.parent?.insertAfter(x.previousSibling, subShapeNode);
        } else {
            this.groupShapes(x, subShapes);
        }

        x.parent?.remove(x);
    }

    private groupShapes(node: ShapeNode, subShapes: IShape[]) {
        const folder = new GroupNode({ document: this.document, name: node.name });
        folder.transform = node.transform;
        node.parent?.insertAfter(node.previousSibling, folder);

        let i = 1;
        for (const subShape of subShapes) {
            const name = `${ShapeTypeUtils.stringValue(subShape.shapeType)} ${i++}`;
            const subShapeNode = new EditableShapeNode({
                document: this.document,
                name,
                shape: subShape,
            });
            folder.add(subShapeNode);
        }
    }

    private explodeComponentNode(x: ComponentNode) {
        for (const node of x.component.nodes) {
            // The hook applies the placement and falls back for a world-space input
            // (a sketch) — no local copy of that logic here.
            x.parent?.insertAfter(x.previousSibling, node.cloneTransformed(x.transform));
        }

        x.parent?.remove(x);
    }

    private explodeMultiShapeNode(x: MultiShapeNode) {
        for (const shape of x.shapes) {
            const node = new EditableShapeNode({
                document: this.document,
                name: x.name,
                shape: shape.transformed(x.transform),
            });
            x.parent?.insertAfter(x.previousSibling, node);
        }

        x.parent?.remove(x);
        x.shapes.forEach((x) => x.dispose());
    }
}
