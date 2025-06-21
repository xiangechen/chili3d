// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, IApplication, ICommand } from "chili-core";

@command({
    key: "edit.undo",
    icon: "icon-undo",
})
export class Undo implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        document?.history.undo();
        document?.visual.update();
    }
}
