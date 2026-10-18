// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    GetOrSelectNodeStep,
    type IShape,
    isReferenceGeometryNode,
    MultistepCommand,
    property,
    ShapeNode,
    Transaction,
} from "@chili3d/core";

export function repairShape(shape: IShape, tolerance: number) {
    // `shape` is owned by the caller (a node's shape); only replaced intermediates are disposed.
    const replaceIfNotNull = (next: IShape, current: IShape) => {
        if (next.isNull()) return current;
        if (current !== shape) current.dispose();
        return next;
    };
    let repairedShape = replaceIfNotNull(shape.shellSewing(tolerance), shape);
    repairedShape = replaceIfNotNull(repairedShape.fixShape(tolerance), repairedShape);
    repairedShape = replaceIfNotNull(repairedShape.fixSmallFace(tolerance), repairedShape);
    return repairedShape;
}

@command({
    key: "modify.repairShape",
    icon: "icon-repair",
})
export class RepairShapeCommand extends MultistepCommand {
    @property("common.tolerance")
    get tolerance() {
        return this.getPrivateValue("tolerance", 1e-5);
    }

    set tolerance(value: number) {
        this.setProperty("tolerance", value);
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `execute ${Object.getPrototypeOf(this).data.name}`, () => {
            if (!this.stepDatas[0].nodes) return;

            for (const node of this.stepDatas[0].nodes) {
                // Defense in depth: the picker filter already excludes datum planes.
                if (isReferenceGeometryNode(node)) continue;
                const shapeNode = node as ShapeNode;
                const shape = shapeNode.shape.value;
                shape.setTolerance(this.tolerance);

                const repairedShape = repairShape(shape, this.tolerance);

                const model = new EditableShapeNode({
                    document: this.document,
                    name: `${node.name}_repaired`,
                    shape: repairedShape,
                    materialId: shapeNode.materialId,
                });
                model.transform = node.transform;
                (node.parent ?? this.document.modelManager.rootNode).add(model);
                node.parent?.remove(node);
            }
            this.document.visual.update();
        });
    }

    protected override getSteps() {
        return [
            new GetOrSelectNodeStep("prompt.select.shape", {
                filter: {
                    allow: (node) => node instanceof ShapeNode,
                },
                multiple: true,
            }),
        ];
    }
}
