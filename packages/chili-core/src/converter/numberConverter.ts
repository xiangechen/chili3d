// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "../base";
import { IConverter } from "./converter";

export class NumberConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        if (Number.isNaN(value)) return Result.error("Number is NaN");
        return Result.ok(String(value));
    }

    convertBack(value: string): Result<number> {
        let n = Number(value);
        if (Number.isNaN(n)) {
            return Result.error(`${value} can not convert to number`);
        }
        return Result.ok(n);
    }
}
