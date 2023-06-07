// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, IDocument } from "chili-core";

@command({
    name: "Delete",
    display: "command.delete",
    icon: "icon-redo",
})
export class Delete implements ICommand {
    async excute(document: IDocument): Promise<void> {
        let models = document.selection.getSelectedNodes();
        models.forEach((model) => model.parent?.remove(model));
        document.visual.viewer.redraw();
    }
}
