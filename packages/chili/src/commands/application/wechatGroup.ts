// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { br, div, img, label } from "chili-controls";
import { command, type IApplication, type ICommand, PubSub } from "chili-core";

@command({
    key: "wechat.group",
    icon: "icon-qrcode",
    isApplicationCommand: true,
})
export class WeChatGroup implements ICommand {
    async execute(app: IApplication): Promise<void> {
        PubSub.default.pub("showDialog", "command.wechat.group", this.ui());
    }

    private ui() {
        return div(
            label(
                {
                    style: {
                        fontSize: "14px",
                        display: "block",
                        textAlign: "center",
                        marginBottom: "10px",
                        opacity: "0.75",
                    },
                },
                "群聊人数已超过200人，只可通过邀请进入群聊",
                br(),
                "入群请先添加个人微信：oOxianOo",
            ),
            img({
                width: 360,
                src: "images/wechat.jpg",
                style: {
                    borderRadius: "10px",
                },
            }),
        );
    }
}
