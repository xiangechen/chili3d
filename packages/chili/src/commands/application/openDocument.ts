// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, ICommand, command } from "chili-core";
import { Document } from "../../document";

@command({
    name: "OpenDocument",
    display: "command.open",
    icon: "icon-open",
})
export class OpenDocument implements ICommand {
    async excute(app: Application): Promise<void> {
        await Document.open("test");
    }
}
