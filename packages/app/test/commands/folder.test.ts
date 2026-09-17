// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, I18n } from "@chili3d/core";
import { createMockApplication, createMockDocument, TestDocument } from "@chili3d/core/test-utils";
import { describe, expect, test } from "@rstest/core";
import { NewFolder } from "../../src/commands/folder";

describe("NewFolder", () => {
    test("should have command metadata", () => {
        const data = (NewFolder as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("create.folder");
        expect(data.icon).toBe("icon-folder-plus");
    });

    test("should create a FolderNode and add it to document", async () => {
        const doc = createMockDocument();
        const addedNodes: unknown[] = [];

        doc.modelManager.addNode = (node: unknown) => {
            addedNodes.push(node);
        };

        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const cmd = new NewFolder();
        await cmd.execute(app);

        expect(addedNodes.length).toBe(1);
        expect(addedNodes[0] instanceof FolderNode).toBe(true);
        expect((addedNodes[0] as FolderNode).name).toBe(`${I18n.translate("command.create.folder")}1`);
    });

    test("folder names should increment within a document", async () => {
        const doc = new TestDocument();
        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        await new NewFolder().execute(app);
        await new NewFolder().execute(app);

        expect(doc.modelManager.findNodes().map((node) => node.name)).toEqual([
            `${I18n.translate("command.create.folder")}1`,
            `${I18n.translate("command.create.folder")}2`,
        ]);
    });

    test("should use activeView document", async () => {
        const doc = createMockDocument();
        let addedNode: unknown;

        doc.modelManager.addNode = (node: unknown) => {
            addedNode = node;
        };

        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const cmd = new NewFolder();
        await cmd.execute(app);

        expect(addedNode).toBeInstanceOf(FolderNode);
    });
});
