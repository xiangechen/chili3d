// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ConverterBase } from "./converter";

export class NumberConverter extends ConverterBase<number> {
    convert(value: number): string | undefined {
        if (Number.isNaN(value)) return undefined;
        return String(value);
    }
    convertBack(value: string): number | undefined {
        let n = Number(value);
        if (Number.isNaN(n)) {
            this._error = `${value} can not convert to number`;
            return undefined;
        }
        return n;
    }
}
