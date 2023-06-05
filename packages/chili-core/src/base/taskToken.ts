// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "./disposable";

export class TaskToken implements IDisposable {
    private readonly _cancelHandles: ((arg: any) => void)[] = [];
    private readonly _completeHandles: ((arg: any) => void)[] = [];

    private _isCancelled: boolean = false;

    get isCancelled() {
        return this._isCancelled;
    }

    private _isCompleted: boolean = false;

    get isCompleted() {
        return this._isCompleted;
    }

    cancel() {
        if (!this._isCancelled) {
            this._isCancelled = true;
            this._cancelHandles.forEach((x) => x(true));
            this.dispose();
        }
    }

    complete() {
        if (!this._isCompleted) {
            this._isCompleted = true;
            this._completeHandles.forEach((x) => x(true));
            this.dispose();
        }
    }

    onCancelled(listener: (arg: boolean) => void): void {
        this._cancelHandles.push(listener);
    }

    onCompleted(listener: (arg: boolean) => void): void {
        this._completeHandles.push(listener);
    }

    dispose(): void | Promise<void> {
        this._cancelHandles.length = 0;
        this._completeHandles.length = 0;
    }
}
