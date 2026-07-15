// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { OpenDocument } from "../../../src/commands/application/openDocument";
import { createMockApplication } from "../../_helpers";

describe("OpenDocument", () => {
    test("should have command metadata", () => {
        const data = (OpenDocument as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("doc.open");
        expect(data.icon).toBe("icon-open");
    });

    test("should have isApplicationCommand flag", () => {
        const data = (OpenDocument as any).prototype.data;
        expect(data.isApplicationCommand).toBe(true);
    });

    test("should publish showPermanent event", async () => {
        let publishedChannel = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ..._args: any[]) => {
            publishedChannel = channel;
        }) as any;

        const app = createMockApplication();
        const cmd = new OpenDocument();
        await cmd.execute(app);

        expect(publishedChannel).toBe("showPermanent");

        PubSub.default.pub = originalPub;
    });
});
