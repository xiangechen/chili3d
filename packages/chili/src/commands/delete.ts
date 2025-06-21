// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, INode, PubSub, Transaction } from "chili-core";
import { GetOrSelectNodeStep, IStep } from "../step";
import { MultistepCommand } from "./multistepCommand";

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

        if (this.document.currentNode && nodes.includes(this.document.currentNode)) {
            this.document.currentNode = this.document.rootNode;
        }

        this.document.selection.clearSelection();
        Transaction.execute(this.document, "delete", () => {
            nodes.forEach((model) => model.parent?.remove(model));
        });
        this.document.visual.update();
        PubSub.default.pub("showToast", "toast.delete{0}Objects", nodes.length);
    }

    protected override getSteps(): IStep[] {
        return [new GetOrSelectNodeStep("prompt.select.models", { multiple: true })];
    }
}
