// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { INode, INodeLinkedList } from "../model";
import { CollectionAction, ICollection } from "./collection";

export interface IHistoryRecord {
    readonly name: string;
    undo(): void;
    redo(): void;
}

export class History {
    private _isDisabled: boolean = false;
    private readonly _undos: IHistoryRecord[] = [];
    private readonly _redos: IHistoryRecord[] = [];

    undoLimits: number = 25;

    get isDisabled() {
        return this._isDisabled;
    }

    add(record: IHistoryRecord) {
        this._redos.length = 0;
        this._undos.push(record);
        while (this._undos.length > this.undoLimits) {
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
        this.tryOperate(() => {
            let records = this._undos.pop();
            if (records === undefined) return;
            records.undo();
            this._redos.push(records);
        });
    }

    redo() {
        this.tryOperate(() => {
            let records = this._redos.pop();
            if (records === undefined) return;
            records.redo();
            this._undos.push(records);
        });
    }

    private tryOperate(action: () => void) {
        let isDisabled = this._isDisabled;
        if (!isDisabled) this._isDisabled = true;
        try {
            action();
        } finally {
            this._isDisabled = isDisabled;
        }
    }
}

export class PropertyHistoryRecord implements IHistoryRecord {
    readonly name: string;
    constructor(
        readonly object: any,
        readonly property: string | symbol | number,
        readonly oldValue: any,
        readonly newValue: any
    ) {
        this.name = `change ${String(property)} property`;
    }

    undo(): void {
        this.object[this.property] = this.oldValue;
    }

    redo(): void {
        this.object[this.property] = this.newValue;
    }
}

export class CollectionHistoryRecord<T> implements IHistoryRecord {
    readonly name: string;
    constructor(readonly collection: ICollection<T>, readonly action: CollectionAction, readonly items: T[]) {
        this.name = `collection ${action}`;
    }

    undo(): void {
        if (this.action === CollectionAction.add) {
            this.collection.remove(...this.items);
        } else if (this.action === CollectionAction.remove) {
            this.collection.add(...this.items);
        }
    }

    redo(): void {
        if (this.action === CollectionAction.add) {
            this.collection.add(...this.items);
        } else if (this.action === CollectionAction.remove) {
            this.collection.remove(...this.items);
        }
    }
}

export enum NodeAction {
    add,
    remove,
    move,
    insertAfter,
    insertBefore,
}

export interface NodeRecord {
    node: INode;
    action: NodeAction;
    oldParent?: INodeLinkedList;
    oldPrevious?: INode;
    newParent?: INodeLinkedList;
    newPrevious?: INode;
}

export class NodeLinkedListHistoryRecord implements IHistoryRecord {
    readonly name: string;
    constructor(readonly records: NodeRecord[]) {
        this.name = `change node`;
    }

    undo() {
        for (let index = this.records.length - 1; index >= 0; index--) {
            let record = this.records[index];
            if (record.action === NodeAction.add) {
                record.newParent?.remove(record.node);
            } else if (record.action === NodeAction.remove) {
                record.oldParent?.add(record.node);
            } else if (record.action === NodeAction.move) {
                record.newParent?.move(record.node, record.oldParent!, record.oldPrevious);
            } else if (record.action === NodeAction.insertAfter) {
                record.newParent?.remove(record.node);
            } else if (record.action === NodeAction.insertBefore) {
                record.newParent?.remove(record.node);
            }
        }
    }

    redo() {
        for (const record of this.records) {
            if (record.action === NodeAction.add) {
                record.newParent?.add(record.node);
            } else if (record.action === NodeAction.remove) {
                record.oldParent?.remove(record.node);
            } else if (record.action === NodeAction.move) {
                record.oldParent?.move(record.node, record.newParent!, record.newPrevious);
            } else if (record.action === NodeAction.insertAfter) {
                record.newParent?.insertAfter(record.newPrevious, record.node);
            } else if (record.action === NodeAction.insertBefore) {
                record.newParent?.insertBefore(record.newPrevious?.nextSibling, record.node);
            }
        }
    }
}

export class ArrayRecord implements IHistoryRecord {
    readonly records: Array<IHistoryRecord> = [];

    constructor(readonly name: string) {}

    undo() {
        for (let index = this.records.length - 1; index >= 0; index--) {
            this.records[index].undo();
        }
    }

    redo() {
        for (const record of this.records) {
            record.redo();
        }
    }
}
