// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DOCUMENT_FILE_EXTENSION, PubSub } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { SaveDocumentToFile } from "../../../src/commands/application/toFile";
import { createMockApplication, createMockDocument } from "../../_helpers";

describe("SaveDocumentToFile", () => {
    test("should have command metadata", () => {
        const data = (SaveDocumentToFile as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("doc.saveToFile");
        expect(data.icon).toBe("icon-download");
    });

    test("should do nothing when no active document", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);
    });

    test("should execute without throwing when activeView but no document", async () => {
        const app = createMockApplication();
        (app as any).activeView = { document: undefined };

        const cmd = new SaveDocumentToFile();
        // Should not throw - early return when document is undefined
        await expect(cmd.execute(app)).resolves.toBeUndefined();
    });

    test("should publish showPermanent event when document exists", async () => {
        let publishedChannel = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ..._args: any[]) => {
            publishedChannel = channel;
        }) as any;

        const doc = createMockDocument();
        doc.serialize = () => ({ test: true }) as any;
        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);

        expect(publishedChannel).toBe("showPermanent");

        PubSub.default.pub = originalPub;
    });

    test("should have DOCUMENT_FILE_EXTENSION available", () => {
        const cmd = new SaveDocumentToFile();
        expect(cmd).toBeDefined();
        expect(DOCUMENT_FILE_EXTENSION).toBeDefined();
        expect(typeof DOCUMENT_FILE_EXTENSION).toBe("string");
    });

    test("should implement ICommand (has execute method)", () => {
        const cmd = new SaveDocumentToFile();
        expect(typeof cmd.execute).toBe("function");
    });
});
