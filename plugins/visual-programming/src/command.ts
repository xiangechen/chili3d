// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type IApplication, type ICommand, PubSub } from "@chili3d/core";
import { Editor } from "./editor";

@command({
    key: "vp.open" as any,
    icon: {
        type: "path",
        value: "icons/visual-programming.svg",
    },
    helpText: "vp.description" as any,
})
export class OpenVisualProgrammingEditorCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        if (!application.activeView) {
            PubSub.default.pub("showToast", "toast.document.noActivated");
            return;
        }
        const editor = new Editor(application.activeView.document);
        await editor.show();
    }
}
