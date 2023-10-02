// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { command, IApplication, ICommand } from "chili-core";

@command({
    name: "edit.redo",
    display: "command.redo",
    icon: "icon-redo",
})
export class Redo implements ICommand {
    async execute(app: IApplication): Promise<void> {
        let document = app.activeDocument!;
        document.history.redo();
        document.visual.viewer.update();
    }
}
