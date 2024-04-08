// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { HistoryObservable, IEqualityComparer, Result } from "../foundation";
import { I18nKeys } from "../i18n";
import { IShape } from "../shape";

export abstract class Entity extends HistoryObservable {
    protected shouldRegenerate: boolean = true;
    abstract display: I18nKeys;

    protected _shape: Result<IShape> = Result.err("Not initialised");
    get shape(): Result<IShape> {
        if (this.shouldRegenerate) {
            this._shape = this.generateShape();
            this.shouldRegenerate = false;
        }
        return this._shape;
    }

    protected setPropertyAndUpdate<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>,
    ) {
        if (this.setProperty(property, newValue, onPropertyChanged, equals)) {
            this.shouldRegenerate = true;
            this.emitShapeChanged();
        }
    }

    protected emitShapeChanged() {
        this.emitPropertyChanged("shape", this._shape);
    }

    protected abstract generateShape(): Result<IShape>;
}
