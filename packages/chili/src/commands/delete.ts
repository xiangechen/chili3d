// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { command, IApplication, ICommand, PubSub, Transaction } from "chili-core";

@command({
    name: "modify.delete",
    display: "command.delete",
    icon: "icon-delete",
})
export class Delete implements ICommand {
    async execute(app: IApplication): Promise<void> {
        let document = app.activeView?.document;
        if (document === undefined) return;
        Transaction.excute(document, "delete", () => {
            let nodes = document.selection.getSelectedNodes();
            if (document.currentNode && nodes.includes(document.currentNode)) {
                document.currentNode = document.rootNode;
            }
            document.selection.clearSelection();
            nodes.forEach((model) => model.parent?.remove(model));
            document.visual.update();
            PubSub.default.pub("showToast", "toast.delete{0}Objects", nodes.length);
        });
    }
}
