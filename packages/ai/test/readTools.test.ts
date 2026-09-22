// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildReadTools, documentSnapshot } from "../src/tools/readTools";

describe("readTools", () => {
    test("get_document_state reports no document when absent", async () => {
        const app = createMockApplication();
        app.activeView = undefined;
        rs.stubGlobal("app", app);
        try {
            const tool = buildReadTools().find((t) => t.name === "get_document_state")!;
            const result = JSON.parse((await tool.handler({})) as string);
            expect(result).toEqual({ hasActiveDocument: false });
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("get_document_state summarizes nodes", async () => {
        const doc = createMockDocument({ name: "part" });
        const findNodes = rs.fn(() => [{ id: "a", name: "box", constructor: { name: "BoxNode" } }]);
        (doc.modelManager as any).findNodes = findNodes;

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);
        try {
            const tool = buildReadTools().find((t) => t.name === "get_document_state")!;
            const result = JSON.parse((await tool.handler({})) as string);
            expect(result.hasActiveDocument).toBe(true);
            expect(result.name).toBe("part");
            expect(result.nodes).toEqual([{ id: "a", type: "BoxNode", name: "box" }]);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    // shapeKind is what decides which shape queries apply to a node: a body, a boolean result and
    // an import are compounds, and a model that cannot see that writes a solid query against one.
    test("get_document_state reports a shape node's kind and nothing for a shape-less node", async () => {
        const doc = createMockDocument({ name: "part" });
        const body = new EditableShapeNode({
            document: doc,
            name: "Body",
            id: "b1",
            shape: { shapeType: ShapeTypes.compound } as unknown as IShape,
        });
        const folder = { id: "f1", name: "Parts", constructor: { name: "FolderNode" } };
        (doc.modelManager as any).findNodes = rs.fn(() => [folder, body]);

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);
        try {
            const tool = buildReadTools().find((t) => t.name === "get_document_state")!;
            const result = JSON.parse((await tool.handler({})) as string);

            expect(result.nodes[0]).toEqual({ id: "f1", type: "FolderNode", name: "Parts" });
            // Absent, not undefined: a folder holds no shape, and the key says so by not being there.
            expect(Object.keys(result.nodes[0])).toEqual(["id", "type", "name"]);
            expect(result.nodes[1]).toEqual({
                id: "b1",
                type: "EditableShapeNode",
                name: "Body",
                shapeKind: "compound",
            });
        } finally {
            rs.unstubAllGlobals();
        }
    });

    // parentId is how the model reads the tree: it names the folder each node sits in, so a
    // group created by create_folder is visible without a second call.
    test("get_document_state reports each node's parentId", async () => {
        const doc = createMockDocument({ name: "part" });
        const folder = { id: "f1", name: "Parts", constructor: { name: "FolderNode" } };
        const child = { id: "a", name: "box", parent: folder, constructor: { name: "BoxNode" } };
        (doc.modelManager as any).findNodes = rs.fn(() => [folder, child]);

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);
        try {
            const tool = buildReadTools().find((t) => t.name === "get_document_state")!;
            const result = JSON.parse((await tool.handler({})) as string);
            expect(result.nodes).toEqual([
                { id: "f1", type: "FolderNode", name: "Parts" },
                { id: "a", type: "BoxNode", name: "box", parentId: "f1" },
            ]);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("documentSnapshot merges the node summary and the selection", () => {
        const doc = createMockDocument({ name: "part" });
        (doc.modelManager as any).findNodes = rs.fn(() => [
            { id: "a", name: "box", constructor: { name: "BoxNode" } },
        ]);
        (doc.selection as any).getSelectedNodes = rs.fn(() => [
            { id: "a", name: "box", constructor: { name: "BoxNode" } },
        ]);

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);
        try {
            const result = JSON.parse(documentSnapshot());
            expect(result.hasActiveDocument).toBe(true);
            expect(result.nodeCount).toBe(1);
            expect(result.selected).toEqual([{ id: "a", type: "BoxNode", name: "box" }]);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("documentSnapshot tolerates a missing application", () => {
        rs.stubGlobal("app", undefined);
        try {
            expect(JSON.parse(documentSnapshot())).toEqual({ hasActiveDocument: false });
        } finally {
            rs.unstubAllGlobals();
        }
    });
});
