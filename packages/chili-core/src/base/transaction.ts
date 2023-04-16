// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { HistoryOperation, IHistoryRecord } from "./history";

export class Transaction {
    private static readonly _transactionMap: WeakMap<IDocument, HistoryOperation> = new WeakMap();

    constructor(readonly document: IDocument, readonly name: string) {}

    static add(document: IDocument, HistoryRecord: IHistoryRecord) {
        if (document.history.isDisabled) return;
        let operation = Transaction._transactionMap.get(document);
        if (operation !== undefined) {
            operation.records.push(HistoryRecord);
        } else {
            operation = new HistoryOperation(HistoryRecord.name);
            operation.records.push(HistoryRecord);
            document.history.add(operation);
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
            throw "The document has started a transaction";
        }
        Transaction._transactionMap.set(this.document, new HistoryOperation(transactionName));
    }

    commit() {
        let operation = Transaction._transactionMap.get(this.document);
        if (operation === undefined) {
            throw "Transaction has not started";
        }
        if (operation.records.length > 0) this.document.history.add(operation);
        Transaction._transactionMap.delete(this.document);
    }

    rollback() {
        let operation = Transaction._transactionMap.get(this.document);
        if (operation == undefined) return;
        operation.undo();
        Transaction._transactionMap.delete(this.document);
    }
}
