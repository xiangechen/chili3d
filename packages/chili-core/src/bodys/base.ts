// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IBody, IShape } from "chili-geo";
import { I18n, ObservableBase, Result } from "chili-shared";

export abstract class BodyBase extends ObservableBase implements IBody {
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
        this.setProperty("body", this.generateBody());
    }

    protected abstract generateBody(): Result<IShape>;
}
