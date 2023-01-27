// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "./document";
import { CollectionAction, ICollection } from "./observer";
import { TransactionItem } from "./transaction";

export type HistoryObject = PropertyHistory | CollectionHistory;

export interface PropertyHistory {
    name: string;
    object: any;
    property: string | symbol | number;
    oldValue: any;
    newValue: any;
}

export interface CollectionHistory {
    name: string;
    collection: ICollection<any>;
    action: CollectionAction;
    item: any;
}

export namespace HistoryObject {
    export function isPropertyHistory(obj: HistoryObject): obj is PropertyHistory {
        return (obj as PropertyHistory).newValue !== undefined;
    }

    export function isCollectionHistory(obj: HistoryObject): obj is CollectionHistory {
        return (obj as CollectionHistory).item !== undefined;
    }

    export function undo(history: HistoryObject) {
        if (HistoryObject.isPropertyHistory(history)) {
            history.object[history.property] = history.oldValue;
        } else if (HistoryObject.isCollectionHistory(history)) {
            if (history.action === CollectionAction.add) {
                history.collection.remove(history.item);
            } else if (history.action === CollectionAction.remove) {
                history.collection.add(history.item);
            }
        }
    }

    export function redo(history: HistoryObject) {
        if (HistoryObject.isPropertyHistory(history)) {
            history.object[history.property] = history.newValue;
        } else if (HistoryObject.isCollectionHistory(history)) {
            if (history.action === CollectionAction.add) {
                history.collection.add(history.item);
            } else if (history.action === CollectionAction.remove) {
                history.collection.remove(history.item);
            }
        }
    }
}

export class History {
    private static readonly _historyMap: WeakMap<IDocument, History> = new WeakMap();
    static undoLimits: number = 25;
    private _isPerforming: boolean;
    private readonly _undos: Array<TransactionItem>;
    private readonly _redos: Array<TransactionItem>;

    constructor() {
        this._isPerforming = false;
        this._undos = [];
        this._redos = [];
    }

    static get(document: IDocument): History {
        let history = History._historyMap.get(document);
        if (history === undefined) {
            history = new History();
            History._historyMap.set(document, history);
        }
        return history;
    }

    static clearHistory(document: IDocument) {
        History._historyMap.delete(document);
    }

    get isPerforming() {
        return this._isPerforming;
    }

    add(action: TransactionItem) {
        if (this._isPerforming) return;
        this._redos.length = 0;
        this._undos.push(action);
        while (this._undos.length > History.undoLimits) {
            this._undos.shift();
        }
    }

    undoCount() {
        return this._undos.length;
    }

    redoCount() {
        return this._redos.length;
    }

    undo() {
        this._isPerforming = true;
        try {
            let action = this._undos.pop();
            if (action === undefined) return;
            for (let index = action.records.length - 1; index >= 0; index--) {
                HistoryObject.undo(action.records[index]);
            }
            this._redos.push(action);
        } catch (e) {
            console.error(e);
        } finally {
            this._isPerforming = false;
        }
    }

    redo() {
        this._isPerforming = true;
        try {
            let action = this._redos.pop();
            if (action === undefined) return;
            for (let index = 0; index < action.records.length; index++) {
                HistoryObject.redo(action.records[index]);
            }
            this._undos.push(action);
        } catch (e) {
            console.error(e);
        } finally {
            this._isPerforming = false;
        }
    }
}
