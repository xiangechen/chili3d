// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable } from "./disposable";

export interface AsyncResult {
    status: "success" | "fail" | "cancel";
    message?: string;
}

export class AsyncController implements IDisposable {
    readonly #failHandles: ((state: AsyncResult) => void)[] = [];
    readonly #successHandles: ((state: AsyncResult) => void)[] = [];

    #result: AsyncResult | undefined;
    get result() {
        return this.#result;
    }

    reset() {
        this.#result = undefined;
    }

    fail = (message?: string) => {
        this.handle(this.#failHandles, "fail", message);
    };

    cancel = (message?: string) => {
        this.handle(this.#failHandles, "cancel", message);
    };

    success = (message?: string) => {
        this.handle(this.#successHandles, "success", message);
    };

    private handle(
        handlers: ((result: AsyncResult) => void)[],
        status: "success" | "cancel" | "fail",
        message?: string,
    ) {
        if (this.#result === undefined) {
            this.#result = { status, message };
            handlers.forEach((x) => x(this.#result!));
        }
    }

    onCancelled(listener: (result: AsyncResult) => void): void {
        this.#failHandles.push(listener);
    }

    onCompleted(listener: (result: AsyncResult) => void): void {
        this.#successHandles.push(listener);
    }

    dispose() {
        this.#failHandles.length = 0;
        this.#successHandles.length = 0;
    }
}
