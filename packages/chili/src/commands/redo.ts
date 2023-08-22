// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, IApplication, ICommand } from "chili-core";

@command({
    name: "doc.cmd.redo",
    display: "command.redo",
    icon: "icon-redo",
})
export class Redo implements ICommand {
    async execute(app: IApplication): Promise<void> {
        let document = app.activeDocument!;
        document.selection.clearSelected();
        document.history.redo();
        document.visual.viewer.redraw();
    }
}
