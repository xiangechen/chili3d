// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export class CancellationToken {
    private _isCanceled: boolean = false;

    get isCanceled() {
        return this._isCanceled;
    }

    cancel() {
        this._isCanceled = true;
    }
}
