// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { HistoryObservable, I18n, IBody, IEqualityComparer, IShape, Result } from "chili-core";
import { IUpdateHandler } from "chili-core/src/model/updateHandler";

export abstract class BodyBase extends HistoryObservable implements IBody {
    updateHandler: ((handler: IUpdateHandler) => void) | undefined;
    abstract name: keyof I18n;

    private _body: Result<IShape> = Result.error("Not initialised");

    get body(): Result<IShape> {
        if (this._body.isErr()) {
            this._body = this.generateBody();
        }
        return this._body;
    }

    protected setPropertyAndUpdateBody<k extends keyof this>(
        property: k,
        newValue: this[k],
        equals?: IEqualityComparer<this[k]>
    ) {
        this.setProperty(property, newValue, equals);
        this._body = this.generateBody();
        this.updateHandler?.(this);
    }

    protected abstract generateBody(): Result<IShape>;
}
