// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, IApplication, ICommand, PubSub, Serialized, command, readFileAsync } from "chili-core";

@command({
    name: "doc.open",
    display: "command.document.open",
    icon: "icon-open",
})
export class OpenDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        PubSub.default.pub(
            "showPermanent",
            async () => {
                let files = await readFileAsync(".cd", false);
                if (files.isOk) {
                    let json: Serialized = JSON.parse(files.value[0].data);
                    let document = await app.loadDocument(json);
                    await document?.application.activeView?.fitContent();
                }
            },
            "toast.excuting{0}",
            I18n.translate("command.document.open"),
        );
    }
}
