// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument, Id, type INode, NodeUtils } from "../src";
import { TestDocument } from "./testDocument";

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

describe("test node", () => {
    const doc: IDocument = new TestDocument() as any;

    test("test get all nodes between two nodes", () => {
        const n1 = new FolderNode(doc, "n1");
        const n2 = new FolderNode(doc, "n2");
        const n3 = new FolderNode(doc, "n3");
        const n4 = new FolderNode(doc, "n4");
        const n5 = new FolderNode(doc, "n5");
        const n6 = new FolderNode(doc, "n6");
        const n7 = new FolderNode(doc, "n7");
        const n8 = new FolderNode(doc, "n8");
        const n9 = new FolderNode(doc, "n9");
        const n10 = new FolderNode(doc, "n10");
        const n11: INode = newNode("n11", "n11");
        // n1
        // ---n2
        //    ---n4
        // ---n3
        //    ---n5
        //    ---n6
        //       ---n7
        //       ---n8
        // ---n9
        // ---n10
        //    ---n11
        n1.add(n2, n3, n9, n10);
        n2.add(n4);
        n3.add(n5, n6);
        n6.add(n7, n8);
        n10.add(n11);
        let nodes = NodeUtils.getNodesBetween(n2, n4);
        expect(nodes.length).toBe(2);
        expect(nodes[0]).toBe(n2);
        expect(nodes[1]).toBe(n4);

        nodes = NodeUtils.getNodesBetween(n8, n3);
        expect(nodes.length).toBe(5);
        expect(nodes[0]).toBe(n3);

        nodes = NodeUtils.getNodesBetween(n7, n11);
        expect(nodes.length).toBe(5);
        expect(nodes[0]).toBe(n7);
        expect(nodes[4]).toBe(n11);
    });
});

describe("test node utils", () => {
    describe("NodeUtils Class Tests", () => {
        let doc: IDocument;

        beforeEach(() => {
            doc = new TestDocument() as any;
        });

        test("NodeUtils findNode functionality", () => {
            const parentNode = new FolderNode(doc, "parent");
            const child1 = newNode("child1");
            const child2 = new FolderNode(doc, "child2");
            const child3 = newNode("targetChild");
            const child4 = newNode("targetChild2");

            parentNode.add(child1, child2, child3);
            child2.add(child4);

            const foundNode = NodeUtils.findNode(parentNode, (node) => node.name === "targetChild");
            expect(foundNode).toBe(child3);

            const foundNode2 = NodeUtils.findNode(parentNode, (node) => node.name === "targetChild2");
            expect(foundNode2).toBe(child4);

            const notFound = NodeUtils.findNode(parentNode, (node) => node.name === "nonexistent");
            expect(notFound).toBeUndefined();
        });

        test("NodeUtils findNodes functionality", () => {
            const parentNode = new FolderNode(doc, "parent");
            const child1 = newNode("child1");
            const child2 = new FolderNode(doc, "child2");
            const child3 = newNode("specialChild");
            const child4 = newNode("specialChild2");

            parentNode.add(child1, child2, child3);
            child2.add(child4);

            const allNodes = NodeUtils.findNodes(parentNode);
            expect(allNodes).toHaveLength(4);
            expect(allNodes).toContain(child1);
            expect(allNodes).toContain(child2);
            expect(allNodes).toContain(child3);
            expect(allNodes).toContain(child4);

            const specialNodes = NodeUtils.findNodes(parentNode, (node) => node.name.includes("special"));
            expect(specialNodes).toHaveLength(2);
            expect(specialNodes).toContain(child3);
            expect(specialNodes).toContain(child4);
        });
    });
});
