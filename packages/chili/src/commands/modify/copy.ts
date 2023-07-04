// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, command, ICommand, Transaction } from "chili-core";
import { Move } from "./move";

@command({
    name: "Copy",
    display: "command.copy",
    icon: "icon-copy",
})
export class Copy extends Move {
    protected override isClone(): boolean {
        return true;
    }
}

@command({
    name: "CopyInplace",
    display: "command.copy",
    icon: "icon-copy",
})
export class CopyInplace implements ICommand {
    async excute(application: Application): Promise<void> {
        let document = application.activeDocument;
        if (document === undefined) return;
        Transaction.excute(document, "copy", () => {
            let models = document!.selection.getSelectedNodes();
            document!.selection.clearSelected();
            models.forEach((model) => model.clone());
            document!.visual.viewer.redraw();
        });
    }
}
