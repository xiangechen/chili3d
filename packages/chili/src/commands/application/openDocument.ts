// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, IApplication, ICommand, PubSub, Serialized, command, readFileAsync } from "chili-core";

@command({
    key: "doc.open",
    icon: "icon-open",
})
export class OpenDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        PubSub.default.pub(
            "showPermanent",
            async () => {
                let files = await readFileAsync(".cd", false);
                if (files.isOk) {
                    let json: Serialized = JSON.parse(files.value[0].data);
                    let document = await app.loadDocument(json);
                    document?.application.activeView?.cameraController.fitContent();
                }
            },
            "toast.excuting{0}",
            I18n.translate("command.doc.open"),
        );
    }
}
