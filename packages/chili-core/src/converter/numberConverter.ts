// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../foundation";
import { IConverter } from "./converter";

export class NumberConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        if (Number.isNaN(value)) return Result.error("Number is NaN");
        return Result.success(String(value));
    }

    convertBack(value: string): Result<number> {
        let n = Number(value);
        if (Number.isNaN(n)) {
            return Result.error(`${value} can not convert to number`);
        }
        return Result.success(n);
    }
}
