// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, Constants, ICommand, command } from "chili-core";
import { Document } from "../../document";

@command({
    name: "OpenDocument",
    display: "command.open",
    icon: "icon-open",
})
export class OpenDocument implements ICommand {
    async excute(app: Application): Promise<void> {
        if (app.activeDocument) {
            await app.activeDocument.save();
            await app.activeDocument.close();
        }
        let data = (await app.storage.page(Constants.DBName, Constants.DocumentTableName, 0)).at(-1);
        let document = await Document.open(data.id);

        app.activeDocument = document;
    }
}
