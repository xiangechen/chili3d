// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    DOCUMENT_FILE_EXTENSION,
    download,
    type I18nKeys,
    type IDocument,
    PubSub,
} from "@chili3d/core";
import { DocumentTaskCommand } from "./documentTaskCommand";

@command({
    key: "doc.saveToFile",
    icon: "icon-download",
    // Downloading outranks everything — see `CommandService`.
    alwaysAvailable: true,
})
export class SaveDocumentToFile extends DocumentTaskCommand {
    protected readonly message: I18nKeys = "command.doc.saveToFile";

    protected async run(document: IDocument): Promise<void> {
        // Let the spinner paint before the synchronous serialize/stringify below.
        await new Promise((r) => {
            setTimeout(r, 100);
        });
        const s = document.serialize();
        PubSub.default.pub("showToast", "toast.downloading");
        download([JSON.stringify(s)], `${document.name}${DOCUMENT_FILE_EXTENSION}`);
    }
}
