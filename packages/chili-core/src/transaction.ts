// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "./document";
import { History, HistoryObject } from "./history";
import { Logger } from "./logger";

export class TransactionItem {
    readonly records: Array<HistoryObject>;

    constructor(readonly name: string) {
        this.records = [];
    }
}

export class Transaction {
    private static readonly _transactionMap: WeakMap<IDocument, TransactionItem> = new WeakMap();

    constructor(readonly document: IDocument, readonly name: string) {}

    static add(document: IDocument, historyObject: HistoryObject) {
        let history = History.get(document);
        if (history.isPerforming) return;
        let transaction = Transaction._transactionMap.get(document);
        if (transaction !== undefined) {
            transaction.records.push(historyObject);
        } else {
            transaction = new TransactionItem(historyObject.name);
            transaction.records.push(historyObject);
            history.add(transaction);
        }
    }

    static excute(document: IDocument, name: string, action: () => void) {
        let trans = new Transaction(document, name);
        trans.start();
        try {
            action();
            trans.commit();
        } catch (e) {
            Logger.error(e);
            trans.rollback();
        }
    }

    start(name?: string) {
        let transactionName = name ?? this.name;
        if (Transaction._transactionMap.get(this.document) !== undefined) {
            Logger.error("在 Transaction commit 之前无法开启另一个 Transaction");
            return;
        }
        Transaction._transactionMap.set(this.document, new TransactionItem(transactionName));
    }

    commit() {
        let transaction = Transaction._transactionMap.get(this.document);
        if (transaction === undefined) {
            Logger.error("请先调用 start");
            return;
        }
        if (transaction.records.length > 0) History.get(this.document).add(transaction);
        Transaction._transactionMap.delete(this.document);
    }

    rollback() {
        let transaction = Transaction._transactionMap.get(this.document);
        if (transaction == undefined) return;
        for (let index = transaction.records.length - 1; index >= 0; index--) {
            const element = transaction.records[index];
            HistoryObject.undo(element);
        }
        Transaction._transactionMap.delete(this.document);
    }
}
