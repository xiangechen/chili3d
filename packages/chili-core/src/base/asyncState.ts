// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "./disposable";

export interface State {
    status: "success" | "fail" | "cancel";
    prompt?: string;
}

export class AsyncState implements IDisposable {
    private readonly _failHandles: ((state: State) => void)[] = [];
    private readonly _successHandles: ((state: State) => void)[] = [];

    private _state: State | undefined;

    get state() {
        return this._state;
    }

    fail = (prompt?: string) => {
        this.handle(this._failHandles, "fail", prompt);
    };

    cancel = (prompt?: string) => {
        this.handle(this._failHandles, "cancel", prompt);
    };

    success = (prompt?: string) => {
        this.handle(this._successHandles, "success", prompt);
    };

    private handle(
        handlers: ((state: State) => void)[],
        status: "success" | "cancel" | "fail",
        prompt?: string
    ) {
        if (this._state === undefined) {
            this._state = { status, prompt };
            handlers.forEach((x) => x(this._state!));
        }
    }

    onCancelled(listener: (state: State) => void): void {
        this._failHandles.push(listener);
    }

    onCompleted(listener: (state: State) => void): void {
        this._successHandles.push(listener);
    }

    dispose() {
        this._failHandles.length = 0;
        this._successHandles.length = 0;
    }
}
