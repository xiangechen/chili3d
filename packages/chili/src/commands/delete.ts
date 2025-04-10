// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

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
