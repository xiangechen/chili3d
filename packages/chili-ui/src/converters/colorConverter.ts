// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
