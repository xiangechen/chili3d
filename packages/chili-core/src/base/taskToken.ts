// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "./disposable";

export class TaskToken implements IDisposable {
    private readonly _cancelHandles: ((arg: any) => void)[] = [];
    private readonly _completeHandles: ((arg: any) => void)[] = [];

    private _isCancellationRequested: boolean = false;

    get isCanceled() {
        return this._isCancellationRequested;
    }

    private _isCompleteRequested: boolean = false;

    get isCompleted() {
        return this._isCompleteRequested;
    }

    cancel() {
        if (!this._isCancellationRequested) {
            this._isCancellationRequested = true;
            this._cancelHandles.forEach((x) => x(true));
            this.dispose();
        }
    }

    complete() {
        if (!this._isCompleteRequested) {
            this._isCompleteRequested = true;
            this._completeHandles.forEach((x) => x(true));
            this.dispose();
        }
    }

    onCancellationRequested(listener: (arg: boolean) => void): void {
        this._cancelHandles.push(listener);
    }

    onCompletedRequested(listener: (arg: boolean) => void): void {
        this._completeHandles.push(listener);
    }

    dispose(): void | Promise<void> {
        this._cancelHandles.length = 0;
        this._completeHandles.length = 0;
    }
}
