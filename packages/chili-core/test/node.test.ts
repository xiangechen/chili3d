// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument, INode } from "../src";
import { TestDocument } from "./testDocument";

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
        const n11: INode = {
            id: "n11",
            name: "n11",
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
        let nodes = INode.getNodesBetween(n2, n4);
        expect(nodes.length).toBe(2);
        expect(nodes[0]).toBe(n2);
        expect(nodes[1]).toBe(n4);

        nodes = INode.getNodesBetween(n8, n3);
        expect(nodes.length).toBe(5);
        expect(nodes[0]).toBe(n3);

        nodes = INode.getNodesBetween(n7, n11);
        expect(nodes.length).toBe(5);
        expect(nodes[0]).toBe(n7);
        expect(nodes[4]).toBe(n11);
    });
});
