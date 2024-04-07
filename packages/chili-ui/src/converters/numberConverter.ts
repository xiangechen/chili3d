// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, Result } from "chili-core";

export class NumberConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        if (Number.isNaN(value)) return Result.err("Number is NaN");
        return Result.ok(String(value));
    }

    convertBack(value: string): Result<number> {
        let n = Number(value);
        if (Number.isNaN(n)) {
            return Result.err(`${value} can not convert to number`);
        }
        return Result.ok(n);
    }
}
