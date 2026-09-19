// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { History, type IDocument, type PropertyHistoryRecord, Transaction } from "../src";

describe("Transaction", () => {
    test("should record history via static add and execute", () => {
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

    test("should manage transaction lifecycle with start, commit and rollback", () => {
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

    // A listener running inside a transaction that edits again — editing the parameter
    // table re-solving a live sketch — is one user action, and had to stop being a throw:
    // the notification swallowed it, so the inner edit was lost without a trace.
    test("execute joins an open transaction — one action, one undo step", () => {
        const doc: IDocument = { history: new History() } as any;
        const record: PropertyHistoryRecord = {} as any;
        let innerRan = false;
        let innerError: unknown;

        Transaction.execute(doc, "outer", () => {
            Transaction.add(doc, record);
            try {
                Transaction.execute(doc, "inner", () => {
                    innerRan = true;
                    Transaction.add(doc, record);
                });
            } catch (error) {
                innerError = error;
            }
            // Still open: nothing reaches the history until the outer transaction commits.
            expect(doc.history.undoCount()).toBe(0);
        });

        expect(innerError).toBeUndefined();
        expect(innerRan).toBe(true);
        expect(doc.history.undoCount()).toBe(1);
    });

    test("a throw inside a joined execute rolls the whole transaction back", () => {
        const doc: IDocument = { history: new History() } as any;
        expect(() =>
            Transaction.execute(doc, "outer", () => {
                Transaction.execute(doc, "inner", () => {
                    throw new Error("inner failed");
                });
            }),
        ).toThrow("inner failed");
        expect(doc.history.undoCount()).toBe(0);
    });

    test("executeAsync joins an open transaction too", async () => {
        const doc: IDocument = { history: new History() } as any;
        const record: PropertyHistoryRecord = {} as any;
        await Transaction.executeAsync(doc, "outer", async () => {
            await Transaction.executeAsync(doc, "inner", async () => {
                Transaction.add(doc, record);
            });
        });
        expect(doc.history.undoCount()).toBe(1);
    });
});
