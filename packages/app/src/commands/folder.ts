// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, FolderNode, I18n, type IApplication, type ICommand, NodeUtils } from "@chili3d/core";

@command({
    key: "create.folder",
    icon: "icon-folder-plus",
})
export class NewFolder implements ICommand {
    async execute(app: IApplication): Promise<void> {
        const document = app.activeView?.document!;
        const name = NodeUtils.generateName(document, I18n.translate("command.create.folder"));
        const folder = new FolderNode({ document, name });
        document.modelManager.addNode(folder);
    }
}
