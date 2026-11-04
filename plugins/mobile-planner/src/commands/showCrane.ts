// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    command,
    type I18nKeys,
    type IApplication,
    type ICommand,
    PubSub,
} from "@chili3d/core";

@command({
    key: "mobile.crane.show" as CommandKeys,
    helpText: "mobile.crane.show.description" as I18nKeys,
    icon: {
        type: "path",
        value: "icons/mobile-crane.svg",
    },
})
export class ShowCraneCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        PubSub.default.pub("showToast", "mobile.crane.loaded" as I18nKeys);
    }
}
