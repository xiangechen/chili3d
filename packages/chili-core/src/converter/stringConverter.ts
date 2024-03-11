// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../foundation";
import { IConverter } from "./converter";

export class StringConverter implements IConverter<string> {
    convert(value: string): Result<string> {
        return Result.success(value);
    }
    convertBack(value: string): Result<string> {
        return Result.success(value);
    }
}
