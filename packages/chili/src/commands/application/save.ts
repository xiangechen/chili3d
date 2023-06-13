// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, IDocument } from "chili-core";

@command({
    name: "Save",
    display: "command.save",
    icon: "icon-save",
})
export class Save implements ICommand {
    async excute(document: IDocument): Promise<void> {
        document.save();
    }
}
