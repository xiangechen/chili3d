// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { HistoryOperation, IDocument, IHistory, PropertyHistoryRecord, Transaction } from "../src";

class TestHistory implements IHistory {
    private _undoCount: number = 0;
    private _redoCount: number = 0;

    get isDisabled(): boolean {
        return false;
    }
    add(action: HistoryOperation): void {
        this._undoCount++;
    }
    undo(): void {
        this._undoCount++;
    }
    redo(): void {
        this._redoCount++;
    }
    undoCount(): number {
        return this._undoCount;
    }
    redoCount(): number {
        return this._redoCount;
    }
}

describe("test Transaction", () => {
    test("test static methods", () => {
        let doc: IDocument = { history: new TestHistory() } as any;
        let history: PropertyHistoryRecord = {} as any;
        Transaction.add(doc, history);
        expect(doc.history.undoCount()).toBe(1);
        Transaction.excute(doc, "Test", () => {
            Transaction.add(doc, history);
            Transaction.add(doc, history);
        });
        expect(doc.history.undoCount()).toBe(2);

        expect(() =>
            Transaction.excute(doc, "throw", () => {
                throw "err";
            })
        ).toThrowError("err");
        expect(doc.history.undoCount()).toBe(2);
    });

    test("test methods", () => {
        let doc: IDocument = { history: new TestHistory() } as any;
        let trans = new Transaction(doc, "test");
        expect(() => trans.commit()).toThrowError("Transaction has not started");
        trans.start();
        expect(() => trans.start()).toThrowError("The document has started a transaction");
        trans.rollback();
        expect(() => trans.commit()).toThrowError("Transaction has not started");

        trans.start();
        expect(doc.history.undoCount()).toBe(0);
        let history: PropertyHistoryRecord = {} as any;
        Transaction.add(doc, history);
        trans.commit();
        expect(doc.history.undoCount()).toBe(1);
    });
});
