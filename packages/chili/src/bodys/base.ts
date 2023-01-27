// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { DocumentObject, I18n, IBody, IShape, Result } from "chili-core";

export abstract class BodyBase extends DocumentObject implements IBody {
    private callbacks: Set<() => void> = new Set();

    onUpdate(callback: () => void): void {
        this.callbacks.add(callback);
    }

    abstract name: keyof I18n;

    private _body: Result<IShape> = Result.error("Not initialised");

    get body(): Result<IShape> {
        if (this._body.isErr()) {
            this._body = this.generateBody();
        }
        return this._body;
    }

    protected setPropertyAndUpdateBody<k extends keyof this>(property: k, newValue: this[k]) {
        this.setProperty(property, newValue);
        this._body = this.generateBody();
        this.callbacks.forEach((x) => x());
    }

    protected abstract generateBody(): Result<IShape>;
}
