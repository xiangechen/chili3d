// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IConverter, Result } from "chili-core";

export class ColorConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        return Result.ok(typeof value === "string" ? value : `#${value.toString(16).padStart(6, "0")}`);
    }

    convertBack(value: string): Result<number> {
        const hexValue = value.startsWith("#") ? value.substring(1) : value;
        const result = parseInt(hexValue, 16);
        return Number.isNaN(result) ? Result.err(`Invalid hex string: ${value}`) : Result.ok(result);
    }
}
