// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument } from "../src";
import { TestDocument } from "./testDocument";

describe("test NodeLinkedList", () => {
    const doc: IDocument = new TestDocument() as any;

    test("test add and remove", () => {
        const l1 = new FolderNode(doc, "l1");
        const l2 = new FolderNode(doc, "l2");
        const l3 = new FolderNode(doc, "l3");
        const l4 = new FolderNode(doc, "l4");

        l1.add(l2);
        expect(l1.firstChild).toEqual(l2);
        expect(l1.lastChild).toEqual(l2);
        expect(l1.size()).toBe(1);

        l1.remove(l2);
        expect(l1.firstChild).toBeUndefined();
        expect(l1.lastChild).toBeUndefined();
        expect(l1.size()).toBe(0);

        l1.add(l2);
        l1.add(l3);
        expect(l1.firstChild).toEqual(l2);
        expect(l1.lastChild).toBe(l3);
        expect(l2.nextSibling).toBe(l3);
        expect(l3.previousSibling).toBe(l2);
        expect(l1.size()).toBe(2);

        l1.remove(l2);
        expect(l1.firstChild).toBe(l3);
        expect(l1.lastChild).toBe(l3);
        expect(l1.size()).toBe(1);

        l1.add(l2);
        expect(l1.firstChild).toBe(l3);
        expect(l1.lastChild).toBe(l2);
        l1.add(l4);
        expect(l1.size()).toBe(3);
        expect(l1.lastChild).toBe(l4);
        l1.remove(l2);
        expect(l3.nextSibling).toBe(l4);
        expect(l4.previousSibling).toBe(l3);
        expect(l1.size()).toBe(2);
    });

    test("test insert before", () => {
        const l1 = new FolderNode(doc, "l1");
        const l2 = new FolderNode(doc, "l2");
        const l3 = new FolderNode(doc, "l3");
        const l4 = new FolderNode(doc, "l4");

        l1.insertBefore(undefined, l2);
        expect(l1.firstChild).toBe(l2);
        expect(l1.lastChild).toBe(l2);
        expect(l1.size()).toBe(1);

        l1.insertBefore(l2, l3);
        expect(l1.firstChild).toBe(l3);
        expect(l3.nextSibling).toBe(l2);
        expect(l2.previousSibling).toBe(l3);
        expect(l1.size()).toBe(2);

        l1.insertBefore(l3, l4);
        expect(l2.previousSibling).toBe(l3);
        expect(l3.nextSibling).toBe(l2);
        expect(l3.previousSibling).toBe(l4);
        expect(l4.nextSibling).toBe(l3);
        expect(l1.size()).toBe(3);
    });

    test("test insert after", () => {
        const l1 = new FolderNode(doc, "l1");
        const l2 = new FolderNode(doc, "l2");
        const l3 = new FolderNode(doc, "l3");
        const l4 = new FolderNode(doc, "l4");
        const l5 = new FolderNode(doc, "l5");

        l1.insertAfter(undefined, l2);
        expect(l1.firstChild).toEqual(l2);
        expect(l1.lastChild).toEqual(l2);
        expect(l1.size()).toBe(1);

        l1.insertAfter(l2, l3);
        expect(l1.firstChild).toEqual(l2);
        expect(l1.lastChild).toEqual(l3);
        expect(l2.nextSibling).toBe(l3);
        expect(l2.previousSibling).toBeUndefined();
        expect(l3.previousSibling).toBe(l2);
        expect(l1.size()).toBe(2);

        l1.insertAfter(l2, l4);
        expect(l4.previousSibling).toBe(l2);
        expect(l2.nextSibling).toBe(l4);
        expect(l4.nextSibling).toBe(l3);
        expect(l3.previousSibling).toBe(l4);
        expect(l1.size()).toBe(3);

        l1.insertAfter(undefined, l5);
        expect(l1.firstChild).toBe(l5);
        expect(l5.nextSibling).toBe(l2);
        expect(l2.previousSibling).toBe(l5);
    });

    test("test moveTo", () => {
        const l1 = new FolderNode(doc, "l1");
        const l2 = new FolderNode(doc, "l2");
        const l3 = new FolderNode(doc, "l3");
        const l4 = new FolderNode(doc, "l4");
        const l5 = new FolderNode(doc, "l5");
        const l6 = new FolderNode(doc, "l6");

        l1.add(l2, l4);
        l2.add(l3);
        l1.move(l2, l5);
        expect(l1.count).toBe(1);
        expect(l5.count).toBe(1);
        expect(l1.firstChild?.name).toBe(l4.name);
        expect(l2.firstChild?.name).toBe(l3.name);
        expect(l5.firstChild?.name).toBe(l2.name);

        l5.add(l6);
        l1.move(l4, l5, l2);
        expect(l1.count).toBe(0);
        expect(l5.count).toBe(3);
        expect(l2.nextSibling?.name).toBe(l4.name);
        expect(l4.previousSibling?.name).toBe(l2.name);
        expect(l4.nextSibling?.name).toBe(l6.name);
        expect(l6.previousSibling?.name).toBe(l4.name);
    });

    test("test undo redo", () => {
        const l1 = new FolderNode(doc, "l1");

        // add undo redo
        doc.modelManager.rootNode.add(l1);
        expect(doc.modelManager.rootNode.firstChild).toBe(l1);
        doc.history.undo();
        expect(doc.modelManager.rootNode.firstChild).toBeUndefined();
        doc.history.redo();
        expect(doc.modelManager.rootNode.firstChild).toBe(l1);
        doc.modelManager.rootNode.remove(l1);

        // remove undo redo
        doc.modelManager.rootNode.add(l1);
        expect(doc.modelManager.rootNode.firstChild).toBe(l1);
        doc.modelManager.rootNode.remove(l1);
        expect(doc.modelManager.rootNode.firstChild).toBeUndefined();
        doc.history.undo();
        expect(doc.modelManager.rootNode.firstChild).toBe(l1);
        doc.history.redo();
        expect(doc.modelManager.rootNode.firstChild).toBeUndefined();
        doc.modelManager.rootNode.remove(l1);

        const l2 = new FolderNode(doc, "l2");
        const l3 = new FolderNode(doc, "l3");
        // insertAfter undo redo
        doc.modelManager.rootNode.add(l1, l3);
        doc.modelManager.rootNode.insertAfter(l1, l2);
        expect(l1.nextSibling).toBe(l2);
        expect(l2.previousSibling).toBe(l1);
        expect(l2.nextSibling).toBe(l3);
        expect(l3.previousSibling).toBe(l2);
        doc.history.undo();
        expect(l1.nextSibling).toBe(l3);
        expect(l3.previousSibling).toBe(l1);
        expect(l2.previousSibling).toBeUndefined();
        doc.history.redo();
        expect(l1.nextSibling).toBe(l2);
        expect(l2.previousSibling).toBe(l1);
        expect(l2.nextSibling).toBe(l3);
        expect(l3.previousSibling).toBe(l2);
        doc.modelManager.rootNode.remove(l1, l2, l3);

        // insertBefore undo redo
        doc.modelManager.rootNode.add(l3, l1);
        doc.modelManager.rootNode.insertBefore(l1, l2);
        expect(l3.nextSibling).toBe(l2);
        expect(l2.previousSibling).toBe(l3);
        expect(l2.nextSibling).toBe(l1);
        expect(l1.previousSibling).toBe(l2);
        doc.history.undo();
        expect(l3.nextSibling).toBe(l1);
        expect(l2.nextSibling).toBeUndefined();
        expect(l1.previousSibling).toBe(l3);
        doc.history.redo();
        expect(l3.nextSibling).toBe(l2);
        expect(l2.previousSibling).toBe(l3);
        expect(l2.nextSibling).toBe(l1);
        expect(l1.previousSibling).toBe(l2);
        doc.modelManager.rootNode.remove(l1, l2, l3);

        // move undo redo
        doc.modelManager.rootNode.add(l1, l2);
        doc.modelManager.rootNode.move(l1, doc.modelManager.rootNode, l2);
        expect(l2.nextSibling).toBe(l1);
        expect(l1.previousSibling).toBe(l2);
        doc.history.undo();
        expect(l1.nextSibling).toBe(l2);
        expect(l2.previousSibling).toBe(l1);
        doc.history.redo();
        expect(l2.nextSibling).toBe(l1);
        expect(l1.previousSibling).toBe(l2);
        doc.modelManager.rootNode.remove(l1, l2);

        const l4 = new FolderNode(doc, "l4");
        const l5 = new FolderNode(doc, "l5");
        const l6 = new FolderNode(doc, "l6");
        doc.modelManager.rootNode.add(l1, l2);
        l1.add(l3, l4);
        l2.add(l5);
        l5.add(l6);
        l2.move(l5, l1, l3);
        expect(l2.count).toBe(0);
        expect(l1.count).toBe(3);
        expect(l2.firstChild).toBeUndefined();
        expect(l5.previousSibling).toBe(l3);
        expect(l5.nextSibling).toBe(l4);
        expect(l3.nextSibling).toBe(l5);
        expect(l4.previousSibling?.name).toBe(l5.name);
        expect(l5.firstChild).toBe(l6);

        doc.history.undo();
        expect(l2.count).toBe(1);
        expect(l1.count).toBe(2);
        expect(l2.firstChild).toBe(l5);
        expect(l5.previousSibling).toBe(undefined);
        expect(l5.nextSibling).toBe(undefined);
        expect(l3.nextSibling).toBe(l4);
        expect(l4.previousSibling).toBe(l3);
        expect(l5.firstChild).toBe(l6);

        doc.history.redo();
        expect(l2.count).toBe(0);
        expect(l1.count).toBe(3);
        expect(l2.firstChild).toBeUndefined();
        expect(l5.previousSibling).toBe(l3);
        expect(l5.nextSibling).toBe(l4);
        expect(l3.nextSibling).toBe(l5);
        expect(l4.previousSibling).toBe(l5);
        expect(l5.firstChild).toBe(l6);
    });
});
