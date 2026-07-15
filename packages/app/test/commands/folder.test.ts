// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { NewFolder } from "../../src/commands/folder";
import { createMockApplication, createMockDocument } from "../_helpers";

describe("NewFolder", () => {
    test("should have command metadata", () => {
        const data = (NewFolder as any).prototype.data;
        expect(data).toBeDefined();
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
        expect((addedNodes[0] as FolderNode).name).toContain("Folder");
    });

    test("folder names should increment", async () => {
        const doc1 = createMockDocument();
        const nodes1: unknown[] = [];
        doc1.modelManager.addNode = (node: unknown) => nodes1.push(node);

        const doc2 = createMockDocument();
        const nodes2: unknown[] = [];
        doc2.modelManager.addNode = (node: unknown) => nodes2.push(node);

        const app1 = createMockApplication();
        app1.activeView = { document: doc1 } as any;

        const app2 = createMockApplication();
        app2.activeView = { document: doc2 } as any;

        // Note: the index is module-level, so it increments across instances
        const cmd1 = new NewFolder();
        await cmd1.execute(app1);

        const cmd2 = new NewFolder();
        await cmd2.execute(app2);

        expect((nodes1[0] as FolderNode).name).not.toBe((nodes2[0] as FolderNode).name);
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
