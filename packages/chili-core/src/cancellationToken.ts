// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "./disposable";

export class CancellationToken implements IDisposable {
    private readonly _events: ((arg: any) => void)[] = [];
    private _isCancellationRequested: boolean = false;

    get isCancellationRequested() {
        return this._isCancellationRequested;
    }

    cancel() {
        if (!this._isCancellationRequested) {
            this._isCancellationRequested = true;
            this._events.forEach((x) => x(true));
            this.dispose();
        }
    }

    onCancellationRequested(listener: (arg: boolean) => void): void {
        this._events.push(listener);
    }

    dispose(): void | Promise<void> {
        this._events.length = 0;
    }
}
