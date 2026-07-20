// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument, type INode, NodeUtils } from "../src";
import { Id } from "../src/foundation";
import { TestDocument } from "./mocks";

function newNode(name: string, id?: string): INode {
    return {
        id: id ?? Id.generate(),
        name,
        visible: true,
        parentVisible: true,
        parent: undefined,
        previousSibling: undefined,
        nextSibling: undefined,
        onPropertyChanged: () => {},
        clearPropertyChanged() {},
        removePropertyChanged: () => {},
        clone: () => ({}) as any,
        dispose() {},
    };
}

describe("Node properties", () => {
    const doc: IDocument = new TestDocument() as any;

    test("should clone a FolderNode", () => {
        const n1 = new FolderNode({ document: doc, name: "original" });
        const cloned = n1.clone();
        expect(cloned).toBeDefined();
        expect(cloned.id).not.toBe(n1.id);
        expect(cloned.name).toContain("original_copy");
    });

    test("should set and get name", () => {
        const n1 = new FolderNode({ document: doc, name: "original" });
        expect(n1.name).toBe("original");
        n1.name = "renamed";
        expect(n1.name).toBe("renamed");
    });

    test("should set and get visible", () => {
        const n1 = new FolderNode({ document: doc, name: "n1" });
        expect(n1.visible).toBe(true);
        n1.visible = false;
        expect(n1.visible).toBe(false);
    });

    test("should have parentVisible defaulting to true", () => {
        const n1 = new FolderNode({ document: doc, name: "n1" });
        expect(n1.parentVisible).toBe(true);
    });

    test("should use default name when empty string provided", () => {
        const n1 = new FolderNode({ document: doc, name: "" });
        expect(n1.name).toBe("untitled");
    });
});

describe("NodeUtils additional", () => {
    const doc: IDocument = new TestDocument() as any;

    test("isLinkedListNode should return true for FolderNode", () => {
        const folder = new FolderNode({ document: doc, name: "folder" });
        expect(NodeUtils.isLinkedListNode(folder)).toBe(true);
    });

    test("isLinkedListNode should return false for plain node", () => {
        const node = newNode("plain");
        expect(NodeUtils.isLinkedListNode(node)).toBe(false);
    });

    test("findTopLevelNodes should return nodes without ancestors in set", () => {
        const root = new FolderNode({ document: doc, name: "root" });
        const child = new FolderNode({ document: doc, name: "child" });
        root.add(child);

        const nodeSet = new Set<INode>([root, child]);
        const topNodes = NodeUtils.findTopLevelNodes(nodeSet);
        expect(topNodes).toHaveLength(1);
        expect(topNodes[0]).toBe(root);
    });

    test("findTopLevelNodes should return all nodes when none are ancestors", () => {
        const a = newNode("a");
        const b = newNode("b");
        const nodeSet = new Set<INode>([a, b]);
        const topNodes = NodeUtils.findTopLevelNodes(nodeSet);
        expect(topNodes).toHaveLength(2);
    });

    test("serializeNode should produce serialized array with parentId links", () => {
        const root = new FolderNode({ document: doc, name: "root" });
        const child = new FolderNode({ document: doc, name: "child" });
        root.add(child);

        const serialized = NodeUtils.serializeNode(root);
        expect(Array.isArray(serialized)).toBe(true);
        expect(serialized.length).toBe(2);
    });

    test("getNodesBetween with same node should return single element", () => {
        const n1 = new FolderNode({ document: doc, name: "n1" });
        const nodes = NodeUtils.getNodesBetween(n1, n1);
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toBe(n1);
    });
});
