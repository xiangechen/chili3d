// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, img, label } from "chili-controls";
import { IApplication, ICommand, PubSub, command } from "chili-core";

@command({
    key: "wechat.group",
    icon: "icon-qrcode",
})
export class WeChatGroup implements ICommand {
    async execute(app: IApplication): Promise<void> {
        PubSub.default.pub("showDialog", "command.wechat.group", this.ui());
    }

    private ui() {
        return div(
            label({
                textContent: "chili3d交流群",
                style: {
                    fontSize: "16px",
                    display: "block",
                    textAlign: "center",
                    marginBottom: "10px",
                },
            }),
            img({
                width: 360,
                src: "images/wechat-group.jpg",
                style: {
                    borderRadius: "10px",
                },
            }),
        );
    }
}
