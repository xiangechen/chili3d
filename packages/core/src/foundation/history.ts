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

    /**
     * The record on top of the undo stack — an identity to rewind back to. `undoCount` cannot
     * serve as that mark: once the stack reaches `undoLimits` every further `add` shifts one out,
     * so the count stops moving while the stack keeps changing underneath it.
     */
    undoTop(): IHistoryRecord | undefined {
        return this._undos[this._undos.length - 1];
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

export type NodeAction = "add" | "remove" | "move" | "transfer" | "insertAfter" | "insertBefore";

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
            if (record.action === "remove") {
                record.node.dispose();
            }
        });
        this.records.length = 0;
    }

    // A recorded anchor can go stale over time (e.g. the node was removed outside of the
    // history); fall back to undefined so the node at least returns to the target parent
    // instead of the move being silently skipped.
    private static normalizePrevious(
        previous: INode | undefined,
        parent: INodeLinkedList | undefined,
    ): INode | undefined {
        return previous?.parent === parent ? previous : undefined;
    }

    private handleUndo(record: NodeRecord): void {
        switch (record.action) {
            case "add":
                record.newParent?.remove(record.node);
                break;
            case "remove":
                record.oldParent?.add(record.node);
                break;
            case "transfer":
                record.oldParent?.add(record.node);
                break;
            case "move":
                record.newParent?.move(
                    record.node,
                    record.oldParent!,
                    NodeLinkedListHistoryRecord.normalizePrevious(record.oldPrevious, record.oldParent),
                );
                break;
            case "insertAfter":
                record.newParent?.remove(record.node);
                break;
            case "insertBefore":
                record.newParent?.remove(record.node);
                break;
        }
    }

    private handleRedo(record: NodeRecord): void {
        switch (record.action) {
            case "add":
                record.newParent?.add(record.node);
                break;
            case "remove":
                record.oldParent?.remove(record.node);
                break;
            case "transfer":
                record.oldParent?.transfer(record.node);
                break;
            case "move":
                record.oldParent?.move(
                    record.node,
                    record.newParent!,
                    NodeLinkedListHistoryRecord.normalizePrevious(record.newPrevious, record.newParent),
                );
                break;
            case "insertAfter":
                record.newParent?.insertAfter(record.newPrevious, record.node);
                break;
            case "insertBefore":
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
