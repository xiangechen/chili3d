// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { SaveDocument } from "../../../src/commands/application/saveDocument";
import { createMockApplication, createMockDocument } from "../../_helpers";

describe("SaveDocument", () => {
    test("should have command metadata", () => {
        const data = (SaveDocument as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("doc.save");
        expect(data.icon).toBe("icon-save");
    });

    test("should have isApplicationCommand flag", () => {
        const data = (SaveDocument as any).prototype.data;
        expect(data.isApplicationCommand).toBe(true);
    });

    test("should do nothing when no active document", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new SaveDocument();
        // Should not throw
        await cmd.execute(app);
    });

    test("should execute without throwing when activeView but no document", async () => {
        const app = createMockApplication();
        (app as any).activeView = { document: undefined };

        const cmd = new SaveDocument();
        await expect(cmd.execute(app)).resolves.toBeUndefined();
    });

    test("should publish showPermanent event when document exists", async () => {
        let publishedChannel = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ..._args: any[]) => {
            publishedChannel = channel;
        }) as any;

        const doc = createMockDocument();
        doc.save = async () => {};
        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const cmd = new SaveDocument();
        await cmd.execute(app);

        expect(publishedChannel).toBe("showPermanent");

        PubSub.default.pub = originalPub;
    });

    test("should implement ICommand (has execute method)", () => {
        const cmd = new SaveDocument();
        expect(typeof cmd.execute).toBe("function");
    });
});
