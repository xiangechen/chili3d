// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IHistoryRecord, NodeRecord } from "@chili3d/core";
import { ArrayRecord, History, NodeLinkedListHistoryRecord, PropertyHistoryRecord } from "@chili3d/core";

describe("test history", () => {
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

    test("test modify history", () => {
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
        const mockOldPrevious = {};
        const records: NodeRecord[] = [
            {
                node: mockNode as any,
                action: "move" as const,
                oldParent: {} as any,
                newParent: mockNewParent as any,
                oldPrevious: mockOldPrevious as any,
            },
        ];
        new NodeLinkedListHistoryRecord(records).undo();
        expect(moveCalled).toBe(true);
        expect(moveArgs[0]).toBe(mockNode);
        expect(moveArgs[2]).toBe(mockOldPrevious);
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
