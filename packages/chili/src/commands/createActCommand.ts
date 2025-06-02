// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Act, I18n, IApplication, ICommand, command } from "chili-core";

let index = 0;

@command({
    key: "act.alignCamera",
    icon: "icon-act",
})
export class ActAlignCameraCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const view = application.activeView;
        if (!view) return;

        view.document.acts.push(
            new Act(
                `${I18n.translate("ribbon.group.act")} ${index++}`,
                view.cameraController.cameraPosition,
                view.cameraController.cameraTarget,
                view.cameraController.cameraUp,
            ),
        );
    }
}
