// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, ICommand, command } from "chili-core";
import { Document } from "../../document";

@command({
    name: "NewDocument",
    display: "command.open",
    icon: "icon-new",
})
export class NewDocument implements ICommand {
    async excute(app: Application): Promise<void> {
        if (app.activeDocument) {
            await app.activeDocument.save();
            await app.activeDocument.close();
        }
        let document = new Document("test");
        app.activeDocument = document;
    }
}
