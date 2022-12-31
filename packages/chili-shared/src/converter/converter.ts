// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export interface IConverter<TFrom = any, TTo = string> {
    get error(): string | undefined;
    convert(value: TFrom): TTo | undefined;
    convertBack(value: TTo): TFrom | undefined;
}

export abstract class ConverterBase<TFrom, TTo = string> implements IConverter<TFrom, TTo> {
    protected _error: string | undefined;

    get error(): string | undefined {
        return this._error;
    }
    abstract convert(value: TFrom): TTo | undefined;
    abstract convertBack(value: TTo): TFrom | undefined;
}
