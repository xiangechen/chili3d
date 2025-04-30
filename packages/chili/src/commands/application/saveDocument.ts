// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, I18n, IApplication, ICommand, PubSub } from "chili-core";

@command({
    key: "doc.save",
    icon: "icon-save",
})
export class SaveDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        if (!app.activeView?.document) return;
        PubSub.default.pub(
            "showPermanent",
            async () => {
                await app.activeView?.document!.save();
                PubSub.default.pub("showToast", "toast.document.saved");
            },
            "toast.excuting{0}",
            I18n.translate("command.doc.save"),
        );
    }
}
