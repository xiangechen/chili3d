// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Commands } from "chili-shared";
import { command, ICommand, IDocument } from "chili-core";

@command({
    name: Commands.Redo,
    display: "command.redo",
    icon: "icon-redo",
})
export class Redo implements ICommand {
    async excute(document: IDocument): Promise<boolean> {
        document.redo();
        return true;
    }
}
