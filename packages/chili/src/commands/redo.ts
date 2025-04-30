// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, IApplication, ICommand } from "chili-core";

@command({
    key: "edit.redo",
    icon: "icon-redo",
})
export class Redo implements ICommand {
    async execute(app: IApplication): Promise<void> {
        const document = app.activeView?.document;
        document?.history.redo();
        document?.visual.update();
    }
}
