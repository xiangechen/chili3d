// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDisposable } from "./disposable";

export interface AsyncResult {
    status: "success" | "fail" | "cancel";
    message?: string;
}

export class AsyncController implements IDisposable {
    private readonly _failListeners = new Set<(state: AsyncResult) => void>();
    private readonly _successListeners = new Set<(state: AsyncResult) => void>();
    private _result: AsyncResult | undefined;

    get result() {
        return this._result;
    }

    readonly fail = (message?: string) => {
        this.notifyListeners(this._failListeners, "fail", message);
    };

    readonly cancel = (message?: string) => {
        this.notifyListeners(this._failListeners, "cancel", message);
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
        this._failListeners.add(listener);
    }

    onCompleted(listener: (result: AsyncResult) => void): void {
        this._successListeners.add(listener);
    }

    dispose() {
        this._failListeners.clear();
        this._successListeners.clear();
    }
}
