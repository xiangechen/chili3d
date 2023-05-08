// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, IDocument } from "chili-core";

@command({
    name: "Undo",
    display: "command.undo",
    icon: "icon-undo",
})
export class Undo implements ICommand {
    async excute(document: IDocument): Promise<void> {
        document.visual.selection.clearSelected();
        document.history.undo();
        document.visual.viewer.redraw();
    }
}
