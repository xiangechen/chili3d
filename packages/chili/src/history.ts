// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { HistoryOperation, IHistory, Logger } from "chili-core";

export class History implements IHistory {
    private _isDisabled: boolean = false;
    undoLimits: number = 25;
    private readonly _undos: Array<HistoryOperation>;
    private readonly _redos: Array<HistoryOperation>;

    constructor() {
        this._undos = [];
        this._redos = [];
    }

    get isDisabled() {
        return this._isDisabled;
    }

    add(action: HistoryOperation) {
        this._redos.length = 0;
        this._undos.push(action);
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
            let action = this._undos.pop();
            if (action === undefined) return;
            action.undo();
            this._redos.push(action);
        });
    }

    redo() {
        this.tryOperate(() => {
            let action = this._redos.pop();
            if (action === undefined) return;
            action.redo();
            this._undos.push(action);
        });
    }

    private tryOperate(action: () => void) {
        let isDisabled = this._isDisabled;
        if (!isDisabled) this._isDisabled = true;
        try {
            action();
        } catch (e) {
            throw e;
        } finally {
            this._isDisabled = isDisabled;
        }
    }
}
