// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { History, PropertyHistory } from "../src/history";
import { TransactionItem } from "../src/transaction";

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
        let h: PropertyHistory = {
            name: "test",
            object: obj,
            property: "property",
            oldValue: "p1",
            newValue: "p2",
        };
        let action = new TransactionItem("test");
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
