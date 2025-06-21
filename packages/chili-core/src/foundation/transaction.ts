// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument } from "../document";
import { ArrayRecord, IHistoryRecord } from "./history";
import { Logger } from "./logger";

export class Transaction {
    private static readonly _transactionMap: WeakMap<IDocument, ArrayRecord> = new WeakMap();

    constructor(
        readonly document: IDocument,
        readonly name: string,
    ) {}

    static add(document: IDocument, record: IHistoryRecord) {
        if (document.history.disabled) return;
        let arrayRecord = Transaction._transactionMap.get(document);
        if (arrayRecord !== undefined) {
            arrayRecord.records.push(record);
        } else {
            Transaction.addToHistory(document, record);
        }
    }

    static addToHistory(document: IDocument, record: IHistoryRecord) {
        document.history.add(record);
        Logger.info(`history added ${record.name}`);
    }

    static execute(document: IDocument, name: string, action: () => void) {
        let trans = new Transaction(document, name);
        trans.start();
        try {
            action();
            trans.commit();
        } catch (e) {
            trans.rollback();
            throw e;
        }
    }

    static async executeAsync(document: IDocument, name: string, action: () => Promise<void>) {
        const trans = new Transaction(document, name);
        trans.start();
        try {
            await action();
            trans.commit();
        } catch (e) {
            trans.rollback();
            throw e;
        }
    }

    start(name?: string) {
        const transactionName = name ?? this.name;
        if (Transaction._transactionMap.has(this.document)) {
            throw new Error(`The document has started a transaction ${this.name}`);
        }
        Transaction._transactionMap.set(this.document, new ArrayRecord(transactionName));
    }

    commit() {
        const arrayRecord = Transaction._transactionMap.get(this.document);
        if (!arrayRecord) {
            throw new Error("Transaction has not started");
        }
        if (arrayRecord.records.length > 0) Transaction.addToHistory(this.document, arrayRecord);
        Transaction._transactionMap.delete(this.document);
    }

    rollback() {
        Transaction._transactionMap.get(this.document)?.undo();
        Transaction._transactionMap.delete(this.document);
    }
}
