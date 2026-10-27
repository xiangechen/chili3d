// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, errorText, I18n, type I18nKeys, type IDocument, PubSub } from "@chili3d/core";
import { DocumentTaskCommand } from "./documentTaskCommand";

@command({
    key: "doc.save",
    icon: "icon-save",
    // Saving outranks everything — see `CommandService`: a command refused because another
    // one is running (or because no view is open) is refused silently, which is what made a
    // save click appear to do nothing at all.
    alwaysAvailable: true,
})
export class SaveDocument extends DocumentTaskCommand {
    protected readonly message: I18nKeys = "command.doc.save";

    protected async run(document: IDocument): Promise<void> {
        try {
            await document.save();
        } catch (error) {
            PubSub.default.pub(
                "displayError",
                I18n.translate("toast.document.saveFailed{0}", errorText(error)),
            );
            return;
        }
        PubSub.default.pub("showToast", "toast.document.saved");
    }
}
