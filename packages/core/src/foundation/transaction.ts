// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { ArrayRecord, type IHistoryRecord } from "./history";
import { Logger } from "./logger";

export class Transaction {
    private static readonly _transactionMap: WeakMap<IDocument, ArrayRecord> = new WeakMap();

    constructor(
        readonly document: IDocument,
        readonly name: string,
    ) {}

    static add(document: IDocument, record: IHistoryRecord) {
        if (document.history.disabled) return;
        const arrayRecord = Transaction._transactionMap.get(document);
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

    /**
     * Opens a transaction, runs `action` and commits it — or, when the document already has
     * one open, joins that one: the records merge, so undoing reverts both halves together.
     *
     * The join is what makes a listener that edits a second time work. Editing the parameter
     * table re-solves the live sketch, which commits its own data — one user action, one undo
     * step. Opening a second transaction used to throw inside the notification, where the
     * observer swallowed it: the inner edit was lost with no error anywhere.
     */
    static execute(document: IDocument, name: string, action: () => void) {
        if (Transaction._transactionMap.has(document)) {
            action();
            return;
        }
        const trans = new Transaction(document, name);
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
        if (Transaction._transactionMap.has(document)) {
            await action();
            return;
        }
        const trans = new Transaction(document, name);
        trans.start();

        await Promise.try(async () => {
            await action();
            trans.commit();
        }).catch((e) => {
            trans.rollback();
            throw e;
        });
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
        const transaction = Transaction._transactionMap.get(this.document);
        Transaction._transactionMap.delete(this.document);

        // Undo with the history disabled (what History.undo does) — otherwise undoing a node
        // change notifies the model manager and the rollback records itself as a new entry.
        // Then dispose: undoing flipped each record into the state that knows which of its
        // values the rollback orphaned, so the dispose releases exactly those.
        const history = this.document.history;
        const wasDisabled = history.disabled;
        history.disabled = true;
        try {
            transaction?.undo();
        } finally {
            history.disabled = wasDisabled;
        }
        transaction?.dispose();
    }
}
