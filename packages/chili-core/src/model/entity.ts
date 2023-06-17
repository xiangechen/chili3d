// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { HistoryObservable, IEqualityComparer, ISerialize, Result } from "../base";
import { IShape } from "../geometry";
import { I18n } from "../i18n";

const ShapeChangedEvent = "PropertyChangedEvent";

export abstract class Entity extends HistoryObservable implements ISerialize {
    abstract name: keyof I18n;

    private _shape: Result<IShape> = Result.error("Not initialised");

    get shape(): Result<IShape> {
        return this._shape;
    }

    generate(): boolean {
        this._shape = this.generateShape();
        return this._shape.isOk();
    }

    protected setPropertyAndUpdate<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>
    ) {
        if (this.setProperty(property, newValue, onPropertyChanged, equals)) {
            this._shape = this.generateShape();
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
