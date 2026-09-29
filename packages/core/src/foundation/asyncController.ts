// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDisposable } from "./disposable";

export interface AsyncResult {
    status: "success" | "fail" | "cancel";
    message?: string;
}

export class AsyncController implements IDisposable {
    private readonly _failListeners = new Set<(state: AsyncResult) => void>();
    private readonly _cancelListeners = new Set<(state: AsyncResult) => void>();
    private readonly _successListeners = new Set<(state: AsyncResult) => void>();
    private _result: AsyncResult | undefined;

    get result() {
        return this._result;
    }

    readonly fail = (message?: string) => {
        this.notifyListeners(this._failListeners, "fail", message);
    };

    readonly cancel = (message?: string) => {
        this.notifyListeners(this._cancelListeners, "cancel", message);
    };

    readonly success = (message?: string) => {
        this.notifyListeners(this._successListeners, "success", message);
    };

    private notifyListeners(
        listeners: Set<(result: AsyncResult) => void>,
        status: AsyncResult["status"],
        message?: string,
    ) {
        if (this._result === undefined) {
            this._result = { status, message };
            listeners.forEach((listener) => listener(this._result!));
        }
    }

    onCancelled(listener: (result: AsyncResult) => void): void {
        this.addListener(this._cancelListeners, "cancel", listener);
    }

    onCompleted(listener: (result: AsyncResult) => void): void {
        this.addListener(this._successListeners, "success", listener);
    }

    onFailed(listener: (result: AsyncResult) => void): void {
        this.addListener(this._failListeners, "fail", listener);
    }

    // A listener registered after the result was settled is replayed with that result right
    // away — the notification it waits for already went out and will never come again.
    private addListener(
        listeners: Set<(result: AsyncResult) => void>,
        status: AsyncResult["status"],
        listener: (result: AsyncResult) => void,
    ) {
        if (this._result?.status === status) {
            listener(this._result);
            return;
        }
        listeners.add(listener);
    }

    dispose() {
        this._cancelListeners.clear();
        this._failListeners.clear();
        this._successListeners.clear();
    }
}
