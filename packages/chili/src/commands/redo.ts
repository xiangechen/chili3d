// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand } from "chili-core";
import { Application } from "../application";

@command({
    name: "Redo",
    display: "command.redo",
    icon: "icon-redo",
})
export class Redo implements ICommand {
    async execute(app: Application): Promise<void> {
        let document = app.activeDocument!;
        document.selection.clearSelected();
        document.history.redo();
        document.visual.viewer.redraw();
    }
}
