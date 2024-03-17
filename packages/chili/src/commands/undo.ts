// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { command, IApplication, ICommand } from "chili-core";

@command({
    name: "edit.undo",
    display: "command.undo",
    icon: "icon-undo",
})
export class Undo implements ICommand {
    async execute(application: IApplication): Promise<void> {
        let document = application.activeView?.document;
        document?.history.undo();
        document?.visual.update();
    }
}
