// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument, Matrix4 } from "@chili3d/core";
import { createMockApplication, createMockDocument, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildNodeTools } from "../src/tools/nodeTools";

describe("nodeTools", () => {
    test("delete_node removes a node by id", async () => {
        const removed: string[] = [];
        const node = { id: "n1", name: "box", visible: true, parent: { remove: () => removed.push("n1") } };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "delete_node")!;
            const result = JSON.parse((await tool.handler({ id: "n1" })) as string);
            expect(result.deleted).toBe("n1");
            expect(removed).toEqual(["n1"]);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("set_node_visible toggles node visibility", async () => {
        const node = { id: "n1", name: "box", visible: true };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "set_node_visible")!;
            const result = JSON.parse((await tool.handler({ id: "n1", visible: false })) as string);
            expect(node.visible).toBe(false);
            expect(result.visible).toBe(false);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("set_node_visible returns a self-healing error for a missing node", async () => {
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => []);

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "set_node_visible")!;
            const result = JSON.parse((await tool.handler({ id: "missing", visible: false })) as string);
            expect(result.error).toContain("node not found: missing");
            expect(result.error).toContain("get_document_state");
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("transform_node translates a node", async () => {
        const node = { id: "n1", name: "box", transform: Matrix4.identity() };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "transform_node")!;
            const result = JSON.parse(
                (await tool.handler({ id: "n1", translate: { x: 10, y: 20, z: 30 } })) as string,
            );
            expect(node.transform.toArray().slice(12, 15)).toEqual([10, 20, 30]);
            expect(result.id).toBe("n1");
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("transform_node composes scale, rotation and translation in order", async () => {
        const node = { id: "n1", name: "box", transform: Matrix4.identity() };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "transform_node")!;
            await tool.handler({
                id: "n1",
                scale: 2,
                rotate: { axis: { x: 0, y: 0, z: 1 }, angle: 90 },
                translate: { x: 5, y: 0, z: 0 },
            });
            const expected = Matrix4.fromScale(2, 2, 2)
                .multiply(Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2))
                .multiply(Matrix4.fromTranslation(5, 0, 0));
            expect(node.transform.equals(expected)).toBe(true);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test.each([
        { id: "n1" },
        { id: "n1", rotate: { axis: { x: 0, y: 0, z: 0 }, angle: 90 } },
        { id: "n1", scale: 0 },
        { id: "n1", mirror: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 } } },
    ])("transform_node rejects invalid args %j", async (args) => {
        const node = { id: "n1", name: "box", transform: Matrix4.identity() };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "transform_node")!;
            const result = JSON.parse((await tool.handler(args)) as string);
            expect(result.error).toBeDefined();
            expect(node.transform.equals(Matrix4.identity())).toBe(true);
        } finally {
            rs.unstubAllGlobals();
        }
    });
});

function getTool(name: string) {
    const tool = buildNodeTools().find((t) => t.name === name);
    expect(tool).toBeDefined();
    return tool!;
}

function stubDocument(doc: IDocument) {
    const app = createMockApplication();
    (app as any).activeView = { document: doc };
    rs.stubGlobal("app", app);
}

/** A real folder in a real tree — folder behaviour is what these tests are about. */
function addFolder(doc: TestDocument, name: string) {
    const folder = new FolderNode({ document: doc, name });
    doc.modelManager.addNode(folder);
    return folder;
}

function nodeById(doc: IDocument, id: string) {
    return doc.modelManager.findNodes((n) => n.id === id)[0];
}

describe("create_folder tool", () => {
    afterEach(() => {
        rs.unstubAllGlobals();
    });

    test("creates a folder at the root and moves the given nodes into it", async () => {
        const doc = new TestDocument();
        const part = addFolder(doc, "part");
        stubDocument(doc);

        const result = JSON.parse(
            (await getTool("create_folder").handler({ name: "Parts", nodeIds: [part.id] })) as string,
        );

        expect(result.name).toBe("Parts");
        expect(result.moved).toEqual([part.id]);
        expect(result.parentId).toBe(doc.modelManager.rootNode.id);

        const folder = nodeById(doc, result.id) as FolderNode;
        expect(folder).toBeInstanceOf(FolderNode);
        expect(folder.children().map((c) => c.id)).toEqual([part.id]);
        expect(part.parent).toBe(folder);
    });

    test("generates a name when none is given", async () => {
        const doc = new TestDocument();
        stubDocument(doc);

        const first = JSON.parse((await getTool("create_folder").handler({})) as string);
        const second = JSON.parse((await getTool("create_folder").handler({})) as string);

        expect(first.name).toBe("Folder1");
        expect(second.name).toBe("Folder2");
    });

    test("nests a new folder under parentId", async () => {
        const doc = new TestDocument();
        const outer = addFolder(doc, "outer");
        const part = addFolder(doc, "part");
        stubDocument(doc);

        const result = JSON.parse(
            (await getTool("create_folder").handler({
                name: "inner",
                parentId: outer.id,
                nodeIds: [part.id],
            })) as string,
        );

        const inner = nodeById(doc, result.id);
        expect(inner?.parent).toBe(outer);
        expect(part.parent).toBe(inner);
    });

    // The folder must not be left behind when one of the ids is bad: the AI would then have a
    // stray empty group and no way to tell it apart from one it meant to create.
    test("rejects an unknown node id without creating anything", async () => {
        const doc = new TestDocument();
        stubDocument(doc);

        const result = JSON.parse(
            (await getTool("create_folder").handler({ name: "Parts", nodeIds: ["missing"] })) as string,
        );

        expect(result.error).toContain("node not found: missing");
        expect(doc.modelManager.findNodes(() => true)).toEqual([]);
    });

    test("rejects a parentId that is not a folder", async () => {
        const doc = createMockDocument();
        const box = { id: "b1", name: "box", parent: undefined, constructor: { name: "BoxNode" } };
        (doc.modelManager as any).rootNode = new FolderNode({ document: doc, name: "root" });
        (doc.modelManager as any).findNodes = rs.fn((pred: (n: unknown) => boolean) => [box].filter(pred));
        stubDocument(doc);

        const result = JSON.parse((await getTool("create_folder").handler({ parentId: "b1" })) as string);

        expect(result.error).toContain("not a folder");
    });
});

describe("move_nodes tool", () => {
    afterEach(() => {
        rs.unstubAllGlobals();
    });

    test("moves nodes into a folder and back to the root", async () => {
        const doc = new TestDocument();
        const folder = addFolder(doc, "Parts");
        const part = addFolder(doc, "part");
        stubDocument(doc);

        const into = JSON.parse(
            (await getTool("move_nodes").handler({ nodeIds: [part.id], folderId: folder.id })) as string,
        );
        expect(into.folder).toEqual({ id: folder.id, name: "Parts" });
        expect(into.moved).toEqual([part.id]);
        expect(part.parent).toBe(folder);

        const back = JSON.parse((await getTool("move_nodes").handler({ nodeIds: [part.id] })) as string);
        expect(back.moved).toEqual([part.id]);
        expect(part.parent).toBe(doc.modelManager.rootNode);
    });

    test("skips a node that is already in the target folder", async () => {
        const doc = new TestDocument();
        const folder = addFolder(doc, "Parts");
        const part = addFolder(doc, "part");
        stubDocument(doc);

        await getTool("move_nodes").handler({ nodeIds: [part.id], folderId: folder.id });
        const result = JSON.parse(
            (await getTool("move_nodes").handler({ nodeIds: [part.id], folderId: folder.id })) as string,
        );

        expect(result.moved).toEqual([]);
        expect(result.skipped).toEqual([{ id: part.id, reason: "already a child of this folder" }]);
    });

    test("refuses to move a folder into its own descendant", async () => {
        const doc = new TestDocument();
        const outer = addFolder(doc, "outer");
        const inner = addFolder(doc, "inner");
        stubDocument(doc);

        await getTool("move_nodes").handler({ nodeIds: [inner.id], folderId: outer.id });
        const result = JSON.parse(
            (await getTool("move_nodes").handler({ nodeIds: [outer.id], folderId: inner.id })) as string,
        );

        expect(result.error).toContain("into itself or one of its own descendants");
        expect(outer.parent).toBe(doc.modelManager.rootNode);
    });

    // A node consumed by a parametric body keeps rendering that body wherever it lands, so the
    // move would look applied while the model stayed the same.
    test("refuses to move a tool consumed by a parametric body", async () => {
        const doc = createMockDocument();
        const body = { id: "body1", name: "Body" };
        const tool = { id: "t1", name: "tool", parent: body };
        (doc.modelManager as any).rootNode = new FolderNode({ document: doc, name: "root" });
        (doc.modelManager as any).findNodes = rs.fn((pred: (n: unknown) => boolean) => [tool].filter(pred));
        stubDocument(doc);

        const result = JSON.parse((await getTool("move_nodes").handler({ nodeIds: ["t1"] })) as string);

        expect(result.error).toContain('consumed by "Body"');
        expect(tool.parent).toBe(body);
    });
});
