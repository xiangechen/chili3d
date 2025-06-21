// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
