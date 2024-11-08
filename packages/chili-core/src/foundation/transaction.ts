// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { ArrayRecord, History, IHistoryRecord } from "./history";
import { Logger } from "./logger";

export class Transaction {
    private static readonly _transactionMap: WeakMap<object | symbol, ArrayRecord> = new WeakMap();

    constructor(
        readonly token: object | symbol,
        readonly history: History,
        readonly name: string,
    ) {}

    static add(token: object | symbol, history: History, record: IHistoryRecord) {
        if (history.disabled) return;
        let arrayRecord = Transaction._transactionMap.get(token);
        if (arrayRecord !== undefined) {
            arrayRecord.records.push(record);
        } else {
            Transaction.addToHistory(history, record);
        }
    }

    static addToHistory(history: History, record: IHistoryRecord) {
        history.add(record);
        Logger.info(`history added ${record.name}`);
    }

    static excute(document: IDocument, name: string, action: () => void) {
        let trans = new Transaction(document, document.history, name);
        trans.start();
        try {
            action();
            trans.commit();
        } catch (e) {
            trans.rollback();
            throw e;
        }
    }

    static async excuteAsync(document: IDocument, name: string, action: () => Promise<void>) {
        let trans = new Transaction(document, document.history, name);
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
        let transactionName = name ?? this.name;
        if (Transaction._transactionMap.get(this.token) !== undefined) {
            throw new Error(`The document has started a transaction ${this.name}`);
        }
        Transaction._transactionMap.set(this.token, new ArrayRecord(transactionName));
    }

    commit() {
        let arrayRecord = Transaction._transactionMap.get(this.token);
        if (arrayRecord === undefined) {
            throw new Error("Transaction has not started");
        }
        if (arrayRecord.records.length > 0) Transaction.addToHistory(this.history, arrayRecord);
        Transaction._transactionMap.delete(this.token);
    }

    rollback() {
        Transaction._transactionMap.get(this.token)?.undo();
        Transaction._transactionMap.delete(this.token);
    }
}
