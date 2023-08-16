// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Transaction } from "chili-core";
import { Application } from "../application";

@command({
    name: "Delete",
    display: "command.delete",
    icon: "icon-redo",
})
export class Delete implements ICommand {
    async execute(app: Application): Promise<void> {
        let document = app.activeDocument;
        if (document === undefined) return;
        Transaction.excute(document, "delete", () => {
            let models = document!.selection.getSelectedNodes();
            document!.selection.clearSelected();
            models.forEach((model) => model.parent?.remove(model));
            document!.visual.viewer.redraw();
        });
    }
}
