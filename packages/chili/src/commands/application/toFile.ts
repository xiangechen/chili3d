// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, command, download, I18n, IApplication, ICommand, PubSub } from "chili-core";

@command({
    name: "doc.saveToFile",
    display: "command.document.saveToFile",
    icon: "icon-download",
})
export class SaveDocumentToFile implements ICommand {
    async execute(app: IApplication): Promise<void> {
        if (!app.activeDocument) return;
        PubSub.default.pub(
            "showPermanent",
            async () => {
                await new Promise((r, j) => {
                    setTimeout(r, 100);
                });
                let s = app.activeDocument!.serialize();
                PubSub.default.pub("showToast", "toast.downloading");
                download([JSON.stringify(s)], `${app.activeDocument!.name}.cd`);
            },
            "toast.excuting{0}",
            I18n.translate("command.document.saveToFile"),
        );
    }
}
