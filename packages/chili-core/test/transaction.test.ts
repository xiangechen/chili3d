// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { History, type IDocument, type PropertyHistoryRecord, Transaction } from "../src";

describe("test Transaction", () => {
    test("test static methods", () => {
        const doc: IDocument = { history: new History() } as any;
        const history: PropertyHistoryRecord = {} as any;
        Transaction.add(doc, history);
        expect(doc.history.undoCount()).toBe(1);
        Transaction.execute(doc, "Test", () => {
            Transaction.add(doc, history);
            Transaction.add(doc, history);
        });
        expect(doc.history.undoCount()).toBe(2);

        expect(() =>
            Transaction.execute(doc, "throw", () => {
                throw new Error("err");
            }),
        ).toThrow("err");
        expect(doc.history.undoCount()).toBe(2);
    });

    test("test methods", () => {
        const doc: IDocument = { history: new History() } as any;
        const trans = new Transaction(doc, "test");
        expect(() => trans.commit()).toThrow("Transaction has not started");
        trans.start();
        expect(() => trans.start()).toThrow("The document has started a transaction");
        trans.rollback();
        expect(() => trans.commit()).toThrow("Transaction has not started");

        trans.start();
        expect(doc.history.undoCount()).toBe(0);
        const history: PropertyHistoryRecord = {} as any;
        Transaction.add(doc, history);
        trans.commit();
        expect(doc.history.undoCount()).toBe(1);
    });
});
