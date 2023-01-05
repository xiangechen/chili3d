// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Commands, i18n } from "chili-shared";
import { command, ICommand, IDocument } from "chili-core";

@command({
    name: Commands.Delete,
    display: "command.delete",
    icon: "icon-redo",
})
export class Delete implements ICommand {
    async excute(document: IDocument): Promise<boolean> {
        let models = document.visualization.selection.getSelectedModels();
        document.removeModel(...models);
        document.viewer.redraw();
        return true;
    }
}
