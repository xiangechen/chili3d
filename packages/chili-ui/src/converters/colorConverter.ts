// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, Result } from "chili-core";

export class ColorConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        if (typeof value === "string") {
            return Result.ok(value);
        }
        return Result.ok("#" + value.toString(16).padStart(6, "0"));
    }

    convertBack(value: string): Result<number> {
        if (value.startsWith("#")) {
            value = value.substring(1);
        }
        let result = parseInt(value, 16);
        if (Number.isNaN(value)) return Result.err("Invalid hex string: " + value);
        return Result.ok(result);
    }
}
