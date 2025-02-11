// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, Result } from "chili-core";

export class NumberConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        return Number.isNaN(value) ? Result.err("Number is NaN") : Result.ok(String(value));
    }

    convertBack(value: string): Result<number> {
        const n = Number(value);
        return Number.isNaN(n) ? Result.err(`${value} can not convert to number`) : Result.ok(n);
    }
}
