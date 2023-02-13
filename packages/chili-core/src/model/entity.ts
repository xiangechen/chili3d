// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEqualityComparer } from "../equalityComparer";
import { IShape } from "../geometry";
import { I18n } from "../i18n";
import { HistoryObservable } from "../observer";
import { Result } from "../result";
import { IUpdater } from "./updater";

export abstract class Entity extends HistoryObservable implements IUpdater {
    updater: ((handler: IUpdater) => void) | undefined;
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
            this.updater?.(this);
        }
    }

    protected abstract generateShape(): Result<IShape>;
}
