// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, IApplication, ICommand, PubSub } from "chili-core";

@command({
    name: "SaveDocument",
    display: "command.document.save",
    icon: "icon-save",
})
export class SaveDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        await app.activeDocument?.save();
        PubSub.default.pub("showToast", "toast.document.saved");
    }
}
