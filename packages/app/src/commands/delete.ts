// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    type INode,
    type IStep,
    instanceSourcesInUse,
    isConsumedTool,
    MultistepCommand,
    NodeUtils,
    PubSub,
    Transaction,
} from "@chili3d/core";

@command({
    key: "modify.deleteNode",
    icon: "icon-delete",
})
export class Delete extends MultistepCommand {
    protected override executeMainTask(): void {
        const nodes: INode[] | undefined = this.stepDatas[0].nodes;
        if (!nodes || nodes.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        // Consumed boolean tools belong to the owning body's feature list — deleting
        // one would leave a dangling tool id behind. Remove the boolean feature instead.
        const freeNodes = nodes.filter((x) => !isConsumedTool(x));
        if (freeNodes.length < nodes.length) {
            PubSub.default.pub("showToast", "toast.consumedTool.forbidden");
        }

        // An instance reads its source's geometry; deleting the source would leave it
        // dangling. Deleting the source together with every instance that reads it is
        // fine — only instances that survive this delete pin their source. The helper
        // expands subtrees: deleting a folder (or a body's consumed tools) cascades.
        const stillUsed = instanceSourcesInUse(this.document, freeNodes);
        const deletable = freeNodes.filter((node) => nodeTree(node).every((x) => !stillUsed.has(x.id)));
        if (deletable.length < freeNodes.length) {
            PubSub.default.pub("showToast", "toast.instance.sourceInUse");
        }
        if (deletable.length === 0) return;

        if (
            this.document.modelManager.currentNode &&
            deletable.includes(this.document.modelManager.currentNode)
        ) {
            this.document.modelManager.currentNode = this.document.modelManager.rootNode;
        }

        this.document.selection.clearSelection();
        Transaction.execute(this.document, "delete", () => {
            deletable.forEach((model) => {
                model.parent?.remove(model);
            });
        });
        this.document.visual.update();
        PubSub.default.pub("showToast", "toast.delete{0}Objects", deletable.length);
    }

    protected override getSteps(): IStep[] {
        return [
            // Deleting a datum plane is how a user removes one; its users fall back to
            // their last plane and show a warning rather than blocking the delete.
            new GetOrSelectNodeStep("prompt.select.models", {
                multiple: true,
                allowReferenceGeometry: true,
            }),
        ];
    }
}

/** A node and every descendant — deleting a folder deletes all of them. */
function nodeTree(node: INode): INode[] {
    return NodeUtils.isLinkedListNode(node) ? [node, ...NodeUtils.children(node)] : [node];
}
