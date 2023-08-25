// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, IApplication, ICommand } from "chili-core";

@command({
    name: "edit.undo",
    display: "command.undo",
    icon: "icon-undo",
})
export class Undo implements ICommand {
    async execute(application: IApplication): Promise<void> {
        let document = application.activeDocument!;
        document.selection.clearSelected();
        document.history.undo();
        document.visual.viewer.redraw();
    }
}
