// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { HistoryObservable, IEqualityComparer, ISerialize, Result } from "../base";
import { IShape } from "../geometry";
import { I18nKeys } from "../i18n";

const ShapeChangedEvent = "ShapeChangedEvent";

export abstract class Entity extends HistoryObservable implements ISerialize {
    #retryCount: number = 0;
    protected shouldRegenerate: boolean = true;
    abstract name: I18nKeys;

    private _shape: Result<IShape> = Result.error("Not initialised");

    get shape(): Result<IShape> {
        if (this.shouldRegenerate || (!this._shape.success && this.#retryCount < 3)) {
            this._shape = this.generateShape();
            this.#retryCount = this._shape.success ? 0 : this.#retryCount + 1;
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
        this.eventEmitter.emit(ShapeChangedEvent, this);
    }

    onShapeChanged(handler: (source: Entity) => void) {
        this.eventEmitter.on(ShapeChangedEvent, handler);
    }

    removeShapeChanged(handler: (source: Entity) => void) {
        this.eventEmitter.off(ShapeChangedEvent, handler);
    }

    protected abstract generateShape(): Result<IShape>;
}
