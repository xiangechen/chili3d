// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ArrayRecord, History, PropertyHistoryRecord } from "chili-core";

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
        let obj = new TestClass();
        let history = new History();
        let h: PropertyHistoryRecord = new PropertyHistoryRecord(obj, "property", "p1", "p2");
        let action = new ArrayRecord("test");
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
});
