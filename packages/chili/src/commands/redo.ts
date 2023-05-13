// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, IDocument } from "chili-core";

@command({
    name: "Redo",
    display: "command.redo",
    icon: "icon-redo",
})
export class Redo implements ICommand {
    async excute(document: IDocument): Promise<void> {
        document.selection.clearSelected();
        document.history.redo();
        document.visual.viewer.redraw();
    }
}
