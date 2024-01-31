// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { command, IApplication, ICommand, PubSub, Transaction } from "chili-core";

@command({
    name: "modify.delete",
    display: "command.delete",
    icon: "icon-delete",
})
export class Delete implements ICommand {
    async execute(app: IApplication): Promise<void> {
        let document = app.activeDocument;
        if (document === undefined) return;
        Transaction.excute(document, "delete", () => {
            let models = document!.selection.getSelectedNodes();
            document!.selection.clearSelected();
            models.forEach((model) => model.parent?.remove(model));
            document!.visual.viewer.update();
            PubSub.default.pub("showToast", "toast.delete{0}Objects", models.length);
        });
    }
}
