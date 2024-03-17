// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { HistoryObservable, IEqualityComparer, Result } from "../foundation";
import { IShape } from "../geometry";
import { I18nKeys } from "../i18n";

export abstract class Entity extends HistoryObservable {
    protected readonly shapeChangeHandler: Set<(source: Entity) => void> = new Set();

    private _retryCount: number = 0;
    protected shouldRegenerate: boolean = true;
    abstract name: I18nKeys;

    private _shape: Result<IShape> = Result.error("Not initialised");

    get shape(): Result<IShape> {
        if (this.shouldRegenerate || (!this._shape.success && this._retryCount < 3)) {
            this._shape = this.generateShape();
            this._retryCount = this._shape.success ? 0 : this._retryCount + 1;
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
        this.shapeChangeHandler.forEach((handler) => handler(this));
    }

    onShapeChanged(handler: (source: Entity) => void) {
        this.shapeChangeHandler.add(handler);
    }

    removeShapeChanged(handler: (source: Entity) => void) {
        this.shapeChangeHandler.delete(handler);
    }

    protected abstract generateShape(): Result<IShape>;
}
