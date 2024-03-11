// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable } from "./disposable";

export interface AsyncResult {
    status: "success" | "fail" | "cancel";
    message?: string;
}

export class AsyncController implements IDisposable {
    private readonly _failHandles: ((state: AsyncResult) => void)[] = [];
    private readonly _successHandles: ((state: AsyncResult) => void)[] = [];

    private _result: AsyncResult | undefined;
    get result() {
        return this._result;
    }

    reset() {
        this._result = undefined;
    }

    fail = (message?: string) => {
        this.handle(this._failHandles, "fail", message);
    };

    cancel = (message?: string) => {
        this.handle(this._failHandles, "cancel", message);
    };

    success = (message?: string) => {
        this.handle(this._successHandles, "success", message);
    };

    private handle(
        handlers: ((result: AsyncResult) => void)[],
        status: "success" | "cancel" | "fail",
        message?: string,
    ) {
        if (this._result === undefined) {
            this._result = { status, message };
            handlers.forEach((x) => x(this._result!));
        }
    }

    onCancelled(listener: (result: AsyncResult) => void): void {
        this._failHandles.push(listener);
    }

    onCompleted(listener: (result: AsyncResult) => void): void {
        this._successHandles.push(listener);
    }

    dispose() {
        this._failHandles.length = 0;
        this._successHandles.length = 0;
    }
}
