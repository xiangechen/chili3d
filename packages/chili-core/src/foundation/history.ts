// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { INode, INodeLinkedList } from "../model";
import type { IDisposable } from "./disposable";

export interface IHistoryRecord extends IDisposable {
    readonly name: string;
    undo(): void;
    redo(): void;
}

export class History implements IDisposable {
    private readonly _undos: IHistoryRecord[] = [];
    private readonly _redos: IHistoryRecord[] = [];

    disabled = false;
    undoLimits = 50;

    #isUndoing = false;
    get isUndoing() {
        return this.#isUndoing;
    }
    #isRedoing = false;
    get isRedoing() {
        return this.#isRedoing;
    }

    dispose(): void {
        this._redos.forEach((record) => record.dispose());
        this._undos.forEach((record) => record.dispose());
        this.clear();
    }

    private clear(): void {
        this._undos.length = 0;
        this._redos.length = 0;
    }

    add(record: IHistoryRecord) {
        if (this.disabled) return;

        this._redos.length = 0;
        this._undos.push(record);

        if (this._undos.length > this.undoLimits) {
            const removed = this._undos.shift();
            removed?.dispose();
        }
    }

    undoCount() {
        return this._undos.length;
    }

    redoCount() {
        return this._redos.length;
    }

    undo() {
        this.#isUndoing = true;
        this.tryOperate(
            () => {
                const record = this._undos.pop();
                if (!record) return;

                record.undo();
                this._redos.push(record);
            },
            () => {
                this.#isUndoing = false;
            },
        );
    }

    redo() {
        this.#isRedoing = true;
        this.tryOperate(
            () => {
                const record = this._redos.pop();
                if (!record) return;

                record.redo();
                this._undos.push(record);
            },
            () => {
                this.#isRedoing = false;
            },
        );
    }

    private tryOperate(action: () => void, onFinally: () => void) {
        const previousState = this.disabled;
        this.disabled = true;
        try {
            action();
        } finally {
            this.disabled = previousState;
            onFinally();
        }
    }
}

export class PropertyHistoryRecord implements IHistoryRecord {
    readonly name: string;
    constructor(
        readonly object: any,
        readonly property: string | symbol | number,
        readonly oldValue: any,
        readonly newValue: any,
    ) {
        this.name = `change ${String(property)} property`;
    }

    dispose(): void {}

    undo(): void {
        this.object[this.property] = this.oldValue;
    }

    redo(): void {
        this.object[this.property] = this.newValue;
    }
}

export enum NodeAction {
    add,
    remove,
    move,
    transfer,
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
        this.name = "change node";
    }

    dispose(): void {
        this.records.forEach((record) => {
            if (record.action === NodeAction.remove) {
                record.node.dispose();
            }
        });
        this.records.length = 0;
    }

    private handleUndo(record: NodeRecord): void {
        switch (record.action) {
            case NodeAction.add:
                record.newParent?.remove(record.node);
                break;
            case NodeAction.remove:
                record.oldParent?.add(record.node);
                break;
            case NodeAction.transfer:
                record.oldParent?.add(record.node);
                break;
            case NodeAction.move:
                record.newParent?.move(record.node, record.oldParent!, record.oldPrevious);
                break;
            case NodeAction.insertAfter:
                record.newParent?.remove(record.node);
                break;
            case NodeAction.insertBefore:
                record.newParent?.remove(record.node);
                break;
        }
    }

    private handleRedo(record: NodeRecord): void {
        switch (record.action) {
            case NodeAction.add:
                record.newParent?.add(record.node);
                break;
            case NodeAction.remove:
                record.oldParent?.remove(record.node);
                break;
            case NodeAction.transfer:
                record.oldParent?.transfer(record.node);
                break;
            case NodeAction.move:
                record.oldParent?.move(record.node, record.newParent!, record.newPrevious);
                break;
            case NodeAction.insertAfter:
                record.newParent?.insertAfter(record.newPrevious, record.node);
                break;
            case NodeAction.insertBefore:
                record.newParent?.insertBefore(record.newPrevious?.nextSibling, record.node);
                break;
        }
    }

    undo(): void {
        for (let i = this.records.length - 1; i >= 0; i--) {
            this.handleUndo(this.records[i]);
        }
    }

    redo(): void {
        this.records.forEach((record) => this.handleRedo(record));
    }
}

export class ArrayRecord implements IHistoryRecord {
    readonly records: Array<IHistoryRecord> = [];

    constructor(readonly name: string) {}

    dispose(): void {
        this.records.forEach((r) => r.dispose());
    }

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
