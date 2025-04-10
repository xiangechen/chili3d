// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { command, FolderNode, IApplication, ICommand } from "chili-core";

let index = 1;

@command({
    name: "create.folder",
    display: "command.newFolder",
    icon: "icon-folder-plus",
})
export class NewFolder implements ICommand {
    async execute(app: IApplication): Promise<void> {
        const document = app.activeView?.document!;
        const folder = new FolderNode(document, `Folder${index++}`);
        document.addNode(folder);
    }
}
