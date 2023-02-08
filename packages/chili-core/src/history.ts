// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CollectionAction, ICollection } from "./observer";

export type HistoryRecord = PropertyHistoryRecord | CollectionHistoryRecord;

export interface PropertyHistoryRecord {
    name: string;
    object: any;
    property: string | symbol | number;
    oldValue: any;
    newValue: any;
}

export interface CollectionHistoryRecord {
    name: string;
    collection: ICollection<any>;
    action: CollectionAction;
    item: any;
}

export namespace HistoryRecord {
    export function isPropertyRecord(obj: HistoryRecord): obj is PropertyHistoryRecord {
        return (obj as PropertyHistoryRecord).newValue !== undefined;
    }

    export function isCollectionRecord(obj: HistoryRecord): obj is CollectionHistoryRecord {
        return (obj as CollectionHistoryRecord).item !== undefined;
    }

    export function undo(history: HistoryRecord) {
        if (HistoryRecord.isPropertyRecord(history)) {
            history.object[history.property] = history.oldValue;
        } else if (HistoryRecord.isCollectionRecord(history)) {
            if (history.action === CollectionAction.add) {
                history.collection.remove(history.item);
            } else if (history.action === CollectionAction.remove) {
                history.collection.add(history.item);
            }
        }
    }

    export function redo(history: HistoryRecord) {
        if (HistoryRecord.isPropertyRecord(history)) {
            history.object[history.property] = history.newValue;
        } else if (HistoryRecord.isCollectionRecord(history)) {
            if (history.action === CollectionAction.add) {
                history.collection.add(history.item);
            } else if (history.action === CollectionAction.remove) {
                history.collection.remove(history.item);
            }
        }
    }
}

export class HistoryOperation {
    readonly records: Array<HistoryRecord>;

    constructor(readonly name: string) {
        this.records = [];
    }

    undo() {
        for (let index = this.records.length - 1; index >= 0; index--) {
            HistoryRecord.undo(this.records[index]);
        }
    }

    redo() {
        for (let index = 0; index < this.records.length; index++) {
            HistoryRecord.redo(this.records[index]);
        }
    }
}

export interface IHistory {
    get isDisabled(): boolean;
    add(action: HistoryOperation): void;
    undo(): void;
    redo(): void;
    undoCount(): number;
    redoCount(): number;
}
