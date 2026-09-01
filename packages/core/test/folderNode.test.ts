// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument, type NodeRecord } from "../src";
import { createPlainNode, TestDocument } from "../test-utils";

describe("FolderNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = new TestDocument() as any;
    });

    describe("constructor", () => {
        test("should create with name", () => {
            const node = new FolderNode({ document: doc, name: "folder1" });
            expect(node.name).toBe("folder1");
            expect(node.firstChild).toBeUndefined();
            expect(node.lastChild).toBeUndefined();
            expect(node.count).toBe(0);
            expect(node.size()).toBe(0);
        });

        test("should generate id when not provided", () => {
            const node = new FolderNode({ document: doc, name: "folder1" });
            expect(node.id).not.toBeNull();
        });

        test("should use provided id", () => {
            const node = new FolderNode({ document: doc, name: "folder1", id: "custom-id" });
            expect(node.id).toBe("custom-id");
        });
    });

    describe("add", () => {
        test("should add single child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child = createPlainNode("child1");

            parent.add(child);

            expect(parent.count).toBe(1);
            expect(parent.size()).toBe(1);
            expect(parent.firstChild).toBe(child);
            expect(parent.lastChild).toBe(child);
            expect(child.parent).toBe(parent);
            expect(child.previousSibling).toBeUndefined();
            expect(child.nextSibling).toBeUndefined();
        });

        test("should add multiple children", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            const child2 = createPlainNode("child2");
            const child3 = createPlainNode("child3");

            parent.add(child1, child2, child3);

            expect(parent.count).toBe(3);
            expect(parent.firstChild).toBe(child1);
            expect(parent.lastChild).toBe(child3);
            expect(child1.nextSibling).toBe(child2);
            expect(child2.previousSibling).toBe(child1);
            expect(child2.nextSibling).toBe(child3);
            expect(child3.previousSibling).toBe(child2);
            expect(child3.nextSibling).toBeUndefined();
        });

        test("batch add records per-item newPrevious matching the actual sibling order", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const existing = createPlainNode("existing");
            parent.add(existing);

            const records: NodeRecord[] = [];
            doc.modelManager.addNodeObserver((r) => records.push(...r));
            const child1 = createPlainNode("child1");
            const child2 = createPlainNode("child2");

            parent.add(child1, child2);

            expect(records.length).toBe(2);
            expect(records[0].newPrevious).toBe(existing);
            expect(records[1].newPrevious).toBe(child1);
        });

        test("should set parentVisible on children", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child = createPlainNode("child1");

            parent.add(child);

            expect(child.parentVisible).toBe(true);
        });

        test("should inherit parent visibility", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            parent.visible = false;
            const child = createPlainNode("child1");

            parent.add(child);

            expect(child.parentVisible).toBe(false);
        });
    });

    describe("children", () => {
        test("should return all children in order", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            const child2 = createPlainNode("child2");
            parent.add(child1, child2);

            const result = parent.children();

            expect(result).toHaveLength(2);
            expect(result[0]).toBe(child1);
            expect(result[1]).toBe(child2);
        });

        test("should return empty array for no children", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            expect(parent.children()).toEqual([]);
        });
    });

    describe("remove", () => {
        test("should remove child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            const child2 = createPlainNode("child2");
            parent.add(child1, child2);

            parent.remove(child1);

            expect(parent.count).toBe(1);
            expect(parent.firstChild).toBe(child2);
            expect(parent.lastChild).toBe(child2);
            expect(child1.parent).toBeUndefined();
            expect(child1.parentVisible).toBe(true);
        });

        test("should remove last child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            const child2 = createPlainNode("child2");
            parent.add(child1, child2);

            parent.remove(child2);

            expect(parent.count).toBe(1);
            expect(parent.firstChild).toBe(child1);
            expect(parent.lastChild).toBe(child1);
            expect(child1.nextSibling).toBeUndefined();
        });

        test("should remove middle child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            const child2 = createPlainNode("child2");
            const child3 = createPlainNode("child3");
            parent.add(child1, child2, child3);

            parent.remove(child2);

            expect(parent.count).toBe(2);
            expect(child1.nextSibling).toBe(child3);
            expect(child3.previousSibling).toBe(child1);
            expect(child2.nextSibling).toBeUndefined();
            expect(child2.previousSibling).toBeUndefined();
        });

        test("should remove only child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child = createPlainNode("child1");
            parent.add(child);

            parent.remove(child);

            expect(parent.count).toBe(0);
            expect(parent.firstChild).toBeUndefined();
            expect(parent.lastChild).toBeUndefined();
        });

        test("should only remove children that belong to this parent", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const other = new FolderNode({ document: doc, name: "other" });
            const child1 = createPlainNode("child1");
            const child2 = createPlainNode("child2");
            parent.add(child1);
            other.add(child2);

            parent.remove(child2); // child2 belongs to other, not parent

            expect(parent.count).toBe(1);
            expect(other.count).toBe(1);
        });
    });

    describe("transfer", () => {
        test("should transfer child out", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child = createPlainNode("child1");
            parent.add(child);

            parent.transfer(child);

            expect(parent.count).toBe(0);
            expect(child.parent).toBeUndefined();
            expect(child.parentVisible).toBe(true);
        });
    });

    describe("insertBefore", () => {
        test("should insert before first child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            parent.add(child1);
            const child0 = createPlainNode("child0");

            parent.insertBefore(child1, child0);

            expect(parent.count).toBe(2);
            expect(parent.firstChild).toBe(child0);
            expect(child0.nextSibling).toBe(child1);
            expect(child1.previousSibling).toBe(child0);
        });

        test("should insert before middle child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            const child2 = createPlainNode("child2");
            parent.add(child1, child2);
            const childMid = createPlainNode("childMid");

            parent.insertBefore(child2, childMid);

            expect(parent.count).toBe(3);
            expect(child1.nextSibling).toBe(childMid);
            expect(childMid.previousSibling).toBe(child1);
            expect(childMid.nextSibling).toBe(child2);
            expect(child2.previousSibling).toBe(childMid);
        });

        test("should insert with undefined target (insert as first)", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            parent.add(child1);
            const child0 = createPlainNode("child0");

            parent.insertBefore(undefined, child0);

            expect(parent.firstChild).toBe(child0);
        });

        test("should not insert if target is not a child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const otherNode = createPlainNode("other");
            const newNode = createPlainNode("new");

            parent.insertBefore(otherNode, newNode);

            expect(parent.count).toBe(0);
        });
    });

    describe("insertAfter", () => {
        test("should insert after last child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            parent.add(child1);
            const child2 = createPlainNode("child2");

            parent.insertAfter(child1, child2);

            expect(parent.count).toBe(2);
            expect(parent.lastChild).toBe(child2);
            expect(child1.nextSibling).toBe(child2);
            expect(child2.previousSibling).toBe(child1);
        });

        test("should insert after middle child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            const child3 = createPlainNode("child3");
            parent.add(child1, child3);
            const child2 = createPlainNode("child2");

            parent.insertAfter(child1, child2);

            expect(parent.count).toBe(3);
            expect(child1.nextSibling).toBe(child2);
            expect(child2.nextSibling).toBe(child3);
            expect(child3.previousSibling).toBe(child2);
        });

        test("should insert with undefined target (insert as first)", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child1 = createPlainNode("child1");
            parent.add(child1);
            const child0 = createPlainNode("child0");

            parent.insertAfter(undefined, child0);

            expect(parent.firstChild).toBe(child0);
        });

        test("should not insert if target is not a child", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const otherNode = createPlainNode("other");
            const newNode = createPlainNode("new");

            parent.insertAfter(otherNode, newNode);

            expect(parent.count).toBe(0);
        });
    });

    describe("move", () => {
        test("should move child between folders", () => {
            const folder1 = new FolderNode({ document: doc, name: "folder1" });
            const folder2 = new FolderNode({ document: doc, name: "folder2" });
            const child = createPlainNode("child1");
            folder1.add(child);

            folder1.move(child, folder2);

            expect(folder1.count).toBe(0);
            expect(folder2.count).toBe(1);
            expect(folder2.firstChild).toBe(child);
            expect(child.parent).toBe(folder2);
        });

        test("should move child with previous sibling", () => {
            const folder1 = new FolderNode({ document: doc, name: "folder1" });
            const folder2 = new FolderNode({ document: doc, name: "folder2" });
            const existingChild = createPlainNode("existing");
            const child = createPlainNode("child1");
            folder1.add(child);
            folder2.add(existingChild);

            folder1.move(child, folder2, existingChild);

            expect(folder2.count).toBe(2);
            expect(existingChild.nextSibling).toBe(child);
            expect(child.previousSibling).toBe(existingChild);
        });

        test("should not move if previousSibling is not child of new parent", () => {
            const folder1 = new FolderNode({ document: doc, name: "folder1" });
            const folder2 = new FolderNode({ document: doc, name: "folder2" });
            const folder3 = new FolderNode({ document: doc, name: "folder3" });
            const child = createPlainNode("child1");
            const wrongSibling = createPlainNode("wrong");
            folder1.add(child);
            folder3.add(wrongSibling);

            folder1.move(child, folder2, wrongSibling);

            // Move should be aborted
            expect(folder1.count).toBe(1);
            expect(folder2.count).toBe(0);
        });

        test("should not move child relative to itself", () => {
            const folder = new FolderNode({ document: doc, name: "folder" });
            const a = createPlainNode("a");
            const x = createPlainNode("x");
            folder.add(a, x);

            folder.move(x, folder, x);

            expect(folder.count).toBe(2);
            expect(folder.firstChild).toBe(a);
            expect(folder.lastChild).toBe(x);
            expect(a.nextSibling).toBe(x);
            expect(x.previousSibling).toBe(a);
            expect(x.nextSibling).toBeUndefined();
            expect(x.parent).toBe(folder);
        });

        test("should not move folder into itself", () => {
            const root = new FolderNode({ document: doc, name: "root" });
            const folder = new FolderNode({ document: doc, name: "folder" });
            root.add(folder);

            root.move(folder, folder);

            expect(root.count).toBe(1);
            expect(root.firstChild).toBe(folder);
            expect(folder.parent).toBe(root);
        });

        test("should not move folder into its descendant", () => {
            const root = new FolderNode({ document: doc, name: "root" });
            const folder = new FolderNode({ document: doc, name: "folder" });
            const subFolder = new FolderNode({ document: doc, name: "subFolder" });
            root.add(folder);
            folder.add(subFolder);

            root.move(folder, subFolder);

            expect(root.count).toBe(1);
            expect(folder.parent).toBe(root);
            expect(subFolder.parent).toBe(folder);
        });

        test("should not move node that is not a child of this folder", () => {
            const folder1 = new FolderNode({ document: doc, name: "folder1" });
            const folder2 = new FolderNode({ document: doc, name: "folder2" });
            const child = createPlainNode("child1");
            folder2.add(child);

            folder1.move(child, folder1);

            expect(folder1.count).toBe(0);
            expect(folder2.count).toBe(1);
            expect(child.parent).toBe(folder2);
        });
    });

    describe("visibility propagation", () => {
        test("should propagate parentVisible to children when parent visibility changes", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child = createPlainNode("child1");
            parent.add(child);
            expect(child.parentVisible).toBe(true);

            parent.visible = false;
            expect(child.parentVisible).toBe(false);

            parent.visible = true;
            expect(child.parentVisible).toBe(true);
        });

        test("should propagate parentVisible when parentVisible changes", () => {
            const grandparent = new FolderNode({ document: doc, name: "grandparent" });
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child = createPlainNode("child1");
            grandparent.add(parent);
            parent.add(child);

            expect(child.parentVisible).toBe(true);

            grandparent.visible = false;
            expect(child.parentVisible).toBe(false);
        });
    });

    describe("dispose", () => {
        test("should dispose with children", () => {
            const parent = new FolderNode({ document: doc, name: "parent" });
            const child = createPlainNode("child1");
            parent.add(child);

            // Should not throw
            expect(() => parent.dispose()).not.toThrow();
        });
    });
});
