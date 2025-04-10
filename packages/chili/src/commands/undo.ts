// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { command, IApplication, ICommand } from "chili-core";

@command({
    name: "edit.undo",
    display: "command.undo",
    icon: "icon-undo",
})
export class Undo implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        document?.history.undo();
        document?.visual.update();
    }
}
