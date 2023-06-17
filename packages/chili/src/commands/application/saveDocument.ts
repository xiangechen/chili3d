// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, command, ICommand } from "chili-core";

@command({
    name: "SaveDocument",
    display: "command.save",
    icon: "icon-save",
})
export class SaveDocument implements ICommand {
    async excute(app: Application): Promise<void> {
        let document = app.activeDocument!;
        await document.save();
    }
}
