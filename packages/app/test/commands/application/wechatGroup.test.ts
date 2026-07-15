// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { WeChatGroup } from "../../../src/commands/application/wechatGroup";
import { createMockApplication } from "../../_helpers";

describe("WeChatGroup", () => {
    test("should have command metadata", () => {
        const data = (WeChatGroup as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("wechat.group");
        expect(data.icon).toBe("icon-qrcode");
    });

    test("should have isApplicationCommand flag", () => {
        const data = (WeChatGroup as any).prototype.data;
        expect(data.isApplicationCommand).toBe(true);
    });

    test("should show dialog on execute", async () => {
        let dialogChannel = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ..._args: any[]) => {
            if (channel === "showDialog") {
                dialogChannel = channel;
            }
        }) as any;

        const app = createMockApplication();
        const cmd = new WeChatGroup();
        await cmd.execute(app);

        expect(dialogChannel).toBe("showDialog");

        PubSub.default.pub = originalPub;
    });
});
