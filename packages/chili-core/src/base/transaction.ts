// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { ArrayRecord, IHistoryRecord } from "./history";

export class Transaction {
    private static readonly _transactionMap: WeakMap<IDocument, ArrayRecord> = new WeakMap();

    constructor(readonly document: IDocument, readonly name: string) {}

    static add(document: IDocument, record: IHistoryRecord) {
        if (document.history.isDisabled) return;
        let arrayRecord = Transaction._transactionMap.get(document);
        if (arrayRecord !== undefined) {
            arrayRecord.records.push(record);
        } else {
            document.history.add(record);
        }
    }

    static excute(document: IDocument, name: string, action: () => void) {
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

    start(name?: string) {
        let transactionName = name ?? this.name;
        if (Transaction._transactionMap.get(this.document) !== undefined) {
            throw new Error("The document has started a transaction");
        }
        Transaction._transactionMap.set(this.document, new ArrayRecord(transactionName));
    }

    commit() {
        let arrayRecord = Transaction._transactionMap.get(this.document);
        if (arrayRecord === undefined) {
            throw new Error("Transaction has not started");
        }
        if (arrayRecord.records.length > 0) this.document.history.add(arrayRecord);
        Transaction._transactionMap.delete(this.document);
    }

    rollback() {
        let arrayRecord = Transaction._transactionMap.get(this.document);
        if (arrayRecord == undefined) return;
        arrayRecord.undo();
        Transaction._transactionMap.delete(this.document);
    }
}
