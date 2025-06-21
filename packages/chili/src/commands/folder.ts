// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, FolderNode, IApplication, ICommand } from "chili-core";

let index = 1;

@command({
    key: "create.folder",
    icon: "icon-folder-plus",
})
export class NewFolder implements ICommand {
    async execute(app: IApplication): Promise<void> {
        const document = app.activeView?.document!;
        const folder = new FolderNode(document, `Folder${index++}`);
        document.addNode(folder);
    }
}
