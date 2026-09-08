// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type IApplication, type ICommand, PubSub } from "@chili3d/core";

@command({
    key: "ai.toggleChat",
    icon: "icon-chili",
})
export class ToggleChatCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        PubSub.default.pub("toggleChatPanel");
    }
}
