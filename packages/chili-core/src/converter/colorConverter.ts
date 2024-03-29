// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../foundation";
import { IConverter } from "./converter";

export class ColorConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        return Result.success("#" + value.toString(16).padStart(6, "0"));
    }

    convertBack(value: string): Result<number> {
        if (value.startsWith("#")) {
            value = value.substring(1);
        }
        let result = parseInt(value, 16);
        if (Number.isNaN(value)) return Result.error("Invalid hex string: " + value);
        return Result.success(result);
    }
}
