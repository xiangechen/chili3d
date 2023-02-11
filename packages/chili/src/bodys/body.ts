// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { HistoryObservable, I18n, IBody, IEqualityComparer, IShape, Result } from "chili-core";
import { IUpdateHandler } from "chili-core/src/model/updateHandler";

export abstract class Body extends HistoryObservable implements IBody {
    updateHandler: ((handler: IUpdateHandler) => void) | undefined;
    abstract name: keyof I18n;

    private _shape: Result<IShape> = Result.error("Not initialised");

    get shape(): Result<IShape> {
        return this._shape;
    }

    generate(): boolean {
        this._shape = this.generateShape();
        return this._shape.isOk();
    }

    protected setPropertyAndUpdate<k extends keyof this>(
        property: k,
        newValue: this[k],
        equals?: IEqualityComparer<this[k]>
    ) {
        if (this.setProperty(property, newValue, equals)) {
            this._shape = this.generateShape();
            this.updateHandler?.(this);
        }
    }

    protected abstract generateShape(): Result<IShape>;
}
