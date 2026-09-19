// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument, Id, type INode, NodeUtils } from "../src";
import { TestDocument } from "../test-utils";

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

describe("node", () => {
    const doc: IDocument = new TestDocument() as any;

    test("should get all nodes between two nodes", () => {
        const n1 = new FolderNode({ document: doc, name: "n1" });
        const n2 = new FolderNode({ document: doc, name: "n2" });
        const n3 = new FolderNode({ document: doc, name: "n3" });
        const n4 = new FolderNode({ document: doc, name: "n4" });
        const n5 = new FolderNode({ document: doc, name: "n5" });
        const n6 = new FolderNode({ document: doc, name: "n6" });
        const n7 = new FolderNode({ document: doc, name: "n7" });
        const n8 = new FolderNode({ document: doc, name: "n8" });
        const n9 = new FolderNode({ document: doc, name: "n9" });
        const n10 = new FolderNode({ document: doc, name: "n10" });
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

describe("node utils", () => {
    describe("NodeUtils Class Tests", () => {
        let doc: IDocument;

        beforeEach(() => {
            doc = new TestDocument() as any;
        });

        test("NodeUtils findNode functionality", () => {
            const parentNode = new FolderNode({ document: doc, name: "parent" });
            const child1 = newNode("child1");
            const child2 = new FolderNode({ document: doc, name: "child2" });
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
            const parentNode = new FolderNode({ document: doc, name: "parent" });
            const child1 = newNode("child1");
            const child2 = new FolderNode({ document: doc, name: "child2" });
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

        test("NodeUtils children yields descendants in document order", () => {
            const root = new FolderNode({ document: doc, name: "root" });
            const child1 = newNode("child1");
            const child2 = new FolderNode({ document: doc, name: "child2" });
            const grandChild1 = newNode("grandChild1");
            const grandChild2 = newNode("grandChild2");
            const child3 = newNode("child3");

            root.add(child1, child2, child3);
            child2.add(grandChild1, grandChild2);

            expect(Array.from(NodeUtils.children(root))).toEqual([
                child1,
                child2,
                grandChild1,
                grandChild2,
                child3,
            ]);
            expect(Array.from(NodeUtils.children(root))).not.toContain(root);
        });
    });

    describe("NodeUtils.generateName", () => {
        let doc: TestDocument;

        beforeEach(() => {
            doc = new TestDocument();
        });

        function addNode(name: string) {
            const node = new FolderNode({ document: doc, name });
            doc.modelManager.addNode(node);
            return node;
        }

        test("should number from 1 when the document holds no node of that type", () => {
            expect(NodeUtils.generateName(doc, "Box")).toBe("Box1");
        });

        test("should continue past the highest index in use", () => {
            addNode("Box1");
            addNode("Box3");

            expect(NodeUtils.generateName(doc, "Box")).toBe("Box4");
        });

        test("should not reuse the index of a removed node", () => {
            const box2 = addNode("Box2");
            addNode("Box3");
            doc.modelManager.rootNode.remove(box2);

            expect(NodeUtils.generateName(doc, "Box")).toBe("Box4");
        });

        test("should ignore names that carry no index", () => {
            addNode("Box");
            addNode("Box_copy");
            addNode("BoxA");

            expect(NodeUtils.generateName(doc, "Box")).toBe("Box1");
        });

        test("should treat regex characters in the base name literally", () => {
            addNode("AxB1");

            expect(NodeUtils.generateName(doc, "A.B")).toBe("A.B1");
        });
    });
});
