// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, IApplication, ICommand, PubSub } from "chili-core";

@command({
    name: "modify.delete",
    display: "command.delete",
    icon: "icon-delete",
})
export class Delete implements ICommand {
    async execute(app: IApplication): Promise<void> {
        const document = app.activeView?.document;
        if (!document) return;

        const nodes = document.selection.getSelectedNodes();
        if (document.currentNode && nodes.includes(document.currentNode)) {
            document.currentNode = document.rootNode;
        }

        document.selection.clearSelection();
        nodes.forEach((model) => model.parent?.remove(model));
        document.visual.update();
        PubSub.default.pub("showToast", "toast.delete{0}Objects", nodes.length);
    }
}
