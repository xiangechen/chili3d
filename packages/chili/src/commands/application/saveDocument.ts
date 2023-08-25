// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, IApplication, ICommand, PubSub } from "chili-core";

@command({
    name: "doc.save",
    display: "command.document.save",
    icon: "icon-save",
})
export class SaveDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        if (app.activeDocument) {
            await app.activeDocument.save();
            PubSub.default.pub("showToast", "toast.document.saved");
        } else {
            PubSub.default.pub("showToast", "toast.document.noActived");
        }
    }
}
