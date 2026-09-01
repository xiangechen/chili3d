// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    type INode,
    type IStep,
    isConsumedTool,
    MultistepCommand,
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
        const deletable = nodes.filter((x) => !isConsumedTool(x));
        if (deletable.length < nodes.length) {
            PubSub.default.pub("showToast", "toast.consumedTool.forbidden");
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
            deletable.forEach((model) => model.parent?.remove(model));
        });
        this.document.visual.update();
        PubSub.default.pub("showToast", "toast.delete{0}Objects", deletable.length);
    }

    protected override getSteps(): IStep[] {
        return [new GetOrSelectNodeStep("prompt.select.models", { multiple: true })];
    }
}
