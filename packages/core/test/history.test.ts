// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IHistoryRecord, NodeRecord } from "../src";
import {
    ArrayRecord,
    FolderNode,
    History,
    NodeLinkedListHistoryRecord,
    PropertyHistoryRecord,
    Transaction,
} from "../src";
import { createPlainNode, TestDocument } from "../test-utils";

describe("History", () => {
    class TestClass {
        property: string;
        arrItems: number[];
        setItems: Set<number>;

        constructor() {
            this.property = "p1";
            this.arrItems = [1];
            this.setItems = new Set();
        }
    }

    test("should undo and redo property changes", () => {
        const obj = new TestClass();
        const history = new History();
        const h: PropertyHistoryRecord = new PropertyHistoryRecord(obj, "property", "p1", "p2");
        const action = new ArrayRecord("test");
        action.records.push(h);
        history.add(action);
        expect(history.undoCount()).toBe(1);
        expect(history.redoCount()).toBe(0);
        history.undo();
        expect(obj.property).toBe("p1");
        expect(history.undoCount()).toBe(0);
        expect(history.redoCount()).toBe(1);
        history.redo();
        expect(obj.property).toBe("p2");
        expect(history.undoCount()).toBe(1);
        expect(history.redoCount()).toBe(0);
        history.undo();
        expect(history.redoCount()).toBe(1);
        history.add(action);
        expect(history.undoCount()).toBe(1);
        expect(history.redoCount()).toBe(0);
    });

    test("should set disabled flag and skip add", () => {
        const obj = new TestClass();
        const history = new History();
        history.disabled = true;
        const record = new PropertyHistoryRecord(obj, "property", "p1", "p2");
        history.add(record);
        expect(history.undoCount()).toBe(0);
        expect(history.redoCount()).toBe(0);
    });

    test("should set disabled back to false and allow add", () => {
        const obj = new TestClass();
        const history = new History();
        history.disabled = true;
        history.add(new PropertyHistoryRecord(obj, "property", "v1", "v2"));

        history.disabled = false;
        history.add(new PropertyHistoryRecord(obj, "property", "v2", "v3"));
        expect(history.undoCount()).toBe(1);
    });

    test("should enforce undoLimits by removing oldest records", () => {
        const obj = { val: 0 };
        const history = new History();
        history.undoLimits = 3;
        for (let i = 0; i < 5; i++) {
            history.add(new PropertyHistoryRecord(obj, "val", i, i + 1));
        }
        expect(history.undoCount()).toBe(3);
    });

    test("undoTop keeps naming the newest record once undoLimits starts evicting", () => {
        const obj = { val: 0 };
        const history = new History();
        history.undoLimits = 3;
        const records = [0, 1, 2, 3, 4].map((i) => new PropertyHistoryRecord(obj, "val", i, i + 1));
        for (const record of records.slice(0, 3)) history.add(record);
        const mark = history.undoTop();

        // The stack is full, so `undoCount` cannot move — but the top does, and it is what says
        // how far back a turn has to rewind.
        history.add(records[3]);
        expect(history.undoCount()).toBe(3);
        expect(history.undoTop()).not.toBe(mark);

        history.undo();
        expect(history.undoTop()).toBe(mark);
    });

    test("should dispose all records and clear history", () => {
        const obj = { val: "a" };
        const history = new History();
        history.add(new PropertyHistoryRecord(obj, "val", "a", "b"));
        history.dispose();
        expect(history.undoCount()).toBe(0);
        expect(history.redoCount()).toBe(0);
    });

    test("should clear redos when adding new record", () => {
        const obj = { val: 0 };
        const history = new History();
        history.add(new PropertyHistoryRecord(obj, "val", 0, 1));
        history.undo();
        expect(history.redoCount()).toBe(1);

        history.add(new PropertyHistoryRecord(obj, "val", 1, 2));
        expect(history.redoCount()).toBe(0);
    });

    test("should not throw when undoing empty history", () => {
        const history = new History();
        expect(() => history.undo()).not.toThrow();
        expect(history.undoCount()).toBe(0);
    });

    test("should not throw when redoing empty history", () => {
        const history = new History();
        expect(() => history.redo()).not.toThrow();
        expect(history.redoCount()).toBe(0);
    });

    test("isUndoing flag resets in finally", () => {
        const obj = { val: 0 };
        const history = new History();
        history.add(new PropertyHistoryRecord(obj, "val", 0, 1));
        expect(history.isUndoing).toBe(false);
        history.undo();
        expect(history.isUndoing).toBe(false);
    });

    test("isRedoing flag resets in finally", () => {
        const obj = { val: 0 };
        const history = new History();
        history.add(new PropertyHistoryRecord(obj, "val", 0, 1));
        history.undo();
        expect(history.isRedoing).toBe(false);
        history.redo();
        expect(history.isRedoing).toBe(false);
    });

    test("should disable history during undo operation", () => {
        const obj = { val: "original" };
        const history = new History();
        history.add(new PropertyHistoryRecord(obj, "val", "original", "changed"));
        expect(history.disabled).toBe(false);
        history.undo();
        expect(history.disabled).toBe(false);
        expect(obj.val).toBe("original");
    });

    test("should handle multiple undo/redo cycles", () => {
        const obj = { val: 0 };
        const history = new History();
        history.add(new PropertyHistoryRecord(obj, "val", 0, 1));
        history.add(new PropertyHistoryRecord(obj, "val", 1, 2));

        expect(obj.val).toBe(0);

        history.undo();
        expect(obj.val).toBe(1);

        history.undo();
        expect(obj.val).toBe(0);

        history.redo();
        expect(obj.val).toBe(1);

        history.redo();
        expect(obj.val).toBe(2);
    });

    test("PropertyHistoryRecord undo and redo", () => {
        const obj = { color: "red" };
        const record = new PropertyHistoryRecord(obj, "color", "red", "blue");
        expect(record.name).toBe("change color property");

        record.redo();
        expect(obj.color).toBe("blue");
        record.undo();
        expect(obj.color).toBe("red");
    });

    test("PropertyHistoryRecord with numeric property key", () => {
        const obj = { 0: "a" } as Record<number, string>;
        const record = new PropertyHistoryRecord(obj, 0, "a", "b");
        record.redo();
        expect(obj[0]).toBe("b");
        record.undo();
        expect(obj[0]).toBe("a");
    });

    test("PropertyHistoryRecord with symbol property key", () => {
        const sym = Symbol("test");
        const obj = { [sym]: 1 };
        const record = new PropertyHistoryRecord(obj, sym, 1, 2);
        record.redo();
        expect(obj[sym]).toBe(2);
        record.undo();
        expect(obj[sym]).toBe(1);
    });

    test("PropertyHistoryRecord dispose is no-op", () => {
        const obj = { val: "ok" };
        const record = new PropertyHistoryRecord(obj, "val", "ok", "no");
        expect(() => record.dispose()).not.toThrow();
        record.redo();
        expect(obj.val).toBe("no");
    });

    test("NodeLinkedListHistoryRecord name", () => {
        const nr = new NodeLinkedListHistoryRecord([]);
        expect(nr.name).toBe("change node");
    });

    test("NodeLinkedListHistoryRecord undo 'add' action", () => {
        let removeCalled = false;
        let removedNode: unknown;
        const mockParent = {
            remove(node: unknown) {
                removeCalled = true;
                removedNode = node;
            },
        };
        const mockNode = { dispose() {} };
        const records: NodeRecord[] = [
            { node: mockNode as any, action: "add" as const, newParent: mockParent as any },
        ];
        new NodeLinkedListHistoryRecord(records).undo();
        expect(removeCalled).toBe(true);
        expect(removedNode).toBe(mockNode);
    });

    test("NodeLinkedListHistoryRecord undo 'remove' action", () => {
        let addCalled = false;
        const mockParent = {
            add(_node: unknown) {
                addCalled = true;
            },
        };
        const mockNode = { dispose() {} };
        const records: NodeRecord[] = [
            { node: mockNode as any, action: "remove" as const, oldParent: mockParent as any },
        ];
        new NodeLinkedListHistoryRecord(records).undo();
        expect(addCalled).toBe(true);
    });

    test("NodeLinkedListHistoryRecord undo 'transfer' action", () => {
        let addCalled = false;
        const mockOldParent = {
            add(_node: unknown) {
                addCalled = true;
            },
        };
        const mockNode = { dispose() {} };
        const records: NodeRecord[] = [
            { node: mockNode as any, action: "transfer" as const, oldParent: mockOldParent as any },
        ];
        new NodeLinkedListHistoryRecord(records).undo();
        expect(addCalled).toBe(true);
    });

    test("NodeLinkedListHistoryRecord undo 'move' action", () => {
        let moveCalled = false;
        let moveArgs: unknown[] = [];
        const mockNewParent = {
            move(...args: unknown[]) {
                moveCalled = true;
                moveArgs = args;
            },
        };
        const mockNode = { dispose() {} };
        const mockOldParent = {};
        const mockOldPrevious = { parent: mockOldParent };
        const records: NodeRecord[] = [
            {
                node: mockNode as any,
                action: "move" as const,
                oldParent: mockOldParent as any,
                newParent: mockNewParent as any,
                oldPrevious: mockOldPrevious as any,
            },
        ];
        new NodeLinkedListHistoryRecord(records).undo();
        expect(moveCalled).toBe(true);
        expect(moveArgs[0]).toBe(mockNode);
        expect(moveArgs[2]).toBe(mockOldPrevious);
    });

    test("NodeLinkedListHistoryRecord undo 'move' falls back when oldPrevious is not in oldParent", () => {
        let moveArgs: unknown[] = [];
        const mockNewParent = {
            move(...args: unknown[]) {
                moveArgs = args;
            },
        };
        const mockNode = { dispose() {} };
        const mockOldParent = {};
        const mockOldPrevious = { parent: {} }; // belongs to another parent
        const records: NodeRecord[] = [
            {
                node: mockNode as any,
                action: "move" as const,
                oldParent: mockOldParent as any,
                newParent: mockNewParent as any,
                oldPrevious: mockOldPrevious as any,
            },
        ];
        new NodeLinkedListHistoryRecord(records).undo();
        expect(moveArgs[0]).toBe(mockNode);
        expect(moveArgs[1]).toBe(mockOldParent);
        expect(moveArgs[2]).toBeUndefined();
    });

    test("NodeLinkedListHistoryRecord redo 'move' falls back when newPrevious is not in newParent", () => {
        let moveArgs: unknown[] = [];
        const mockOldParent = {
            move(...args: unknown[]) {
                moveArgs = args;
            },
        };
        const mockNode = { dispose() {} };
        const mockNewParent = {};
        const mockNewPrevious = { parent: {} }; // belongs to another parent
        const records: NodeRecord[] = [
            {
                node: mockNode as any,
                action: "move" as const,
                oldParent: mockOldParent as any,
                newParent: mockNewParent as any,
                newPrevious: mockNewPrevious as any,
            },
        ];
        new NodeLinkedListHistoryRecord(records).redo();
        expect(moveArgs[0]).toBe(mockNode);
        expect(moveArgs[1]).toBe(mockNewParent);
        expect(moveArgs[2]).toBeUndefined();
    });

    test("ArrayRecord undo reverse order", () => {
        const obj = { val: 0 };
        const arrayRecord = new ArrayRecord("multi change");
        arrayRecord.records.push(
            new PropertyHistoryRecord(obj, "val", 0, 1),
            new PropertyHistoryRecord(obj, "val", 1, 2),
            new PropertyHistoryRecord(obj, "val", 2, 3),
        );
        arrayRecord.redo();
        expect(obj.val).toBe(3);
        arrayRecord.undo();
        expect(obj.val).toBe(0);
    });

    test("ArrayRecord undo restores moved node when its anchor was deleted outside history", () => {
        const doc = new TestDocument();
        const folderF = new FolderNode({ document: doc, name: "F" });
        const folderG = new FolderNode({ document: doc, name: "G" });
        const p = createPlainNode("p");
        const a = createPlainNode("a");
        folderF.add(p, a);

        Transaction.execute(doc, "move node", () => {
            folderF.move(a, folderG);
        });

        // the move record's anchor (p) is removed without a history record
        doc.history.disabled = true;
        folderF.remove(p);
        doc.history.disabled = false;

        doc.history.undo();

        // without anchor normalization the move undo is silently skipped and `a` stays in G
        expect(folderF.children()).toEqual([a]);
        expect(folderG.children()).toEqual([]);
    });

    test("ArrayRecord redo restores moved node when its anchor was deleted outside history", () => {
        const doc = new TestDocument();
        const folderF = new FolderNode({ document: doc, name: "F" });
        const folderG = new FolderNode({ document: doc, name: "G" });
        const b = createPlainNode("b");
        const a = createPlainNode("a");
        folderF.add(a);
        folderG.add(b);

        Transaction.execute(doc, "move node", () => {
            folderF.move(a, folderG, b);
        });
        doc.history.undo();
        expect(folderF.children()).toEqual([a]);

        // the redo anchor (b) is removed without a history record
        doc.history.disabled = true;
        folderG.remove(b);
        doc.history.disabled = false;

        doc.history.redo();

        // without anchor normalization the move redo is silently skipped and `a` stays in F
        expect(folderF.children()).toEqual([]);
        expect(folderG.children()).toEqual([a]);
    });

    test("ArrayRecord name and dispose", () => {
        const record = new ArrayRecord("test action");
        expect(record.name).toBe("test action");

        let disposeCalled = false;
        const mockRecord: IHistoryRecord = {
            name: "mock",
            dispose: () => {
                disposeCalled = true;
            },
            undo: () => {},
            redo: () => {},
        };
        record.records.push(mockRecord);
        record.dispose();
        expect(disposeCalled).toBe(true);
    });
});
