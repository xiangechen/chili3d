// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, ModelGroup } from "chili-core";

@command({
    name: "NewGroup",
    display: "command.newGroup",
    icon: "icon-folder-plus",
})
export class NewGroup implements ICommand {
    async excute(document: IDocument): Promise<boolean> {
        let group = new ModelGroup(document, `Group ${document.modelCount}`, Id.new());
        document.addModel(group);
        return true;
    }
}
