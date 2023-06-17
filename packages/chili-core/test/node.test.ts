// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { IDocument, History, INode, NodeLinkedList } from "../src";

describe("test node", () => {
    let doc: IDocument = { history: new History() } as any;

    test("test get all nodes between two nodes", () => {
        let n1 = new NodeLinkedList(doc, "n1");
        let n2 = new NodeLinkedList(doc, "n2");
        let n3 = new NodeLinkedList(doc, "n3");
        let n4 = new NodeLinkedList(doc, "n4");
        let n5 = new NodeLinkedList(doc, "n5");
        let n6 = new NodeLinkedList(doc, "n6");
        let n7 = new NodeLinkedList(doc, "n7");
        let n8 = new NodeLinkedList(doc, "n8");
        let n9 = new NodeLinkedList(doc, "n9");
        let n10 = new NodeLinkedList(doc, "n10");
        let n11: INode = {
            id: "n11",
            name: "n11",
            visible: true,
            parentVisible: true,
            parent: undefined,
            previousSibling: undefined,
            nextSibling: undefined,
            onPropertyChanged: () => {},
            removePropertyChanged: () => {},
            serialize: () => ({} as any),
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
