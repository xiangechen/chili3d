// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "../base";
import { IConverter } from "./converter";

export class StringConverter implements IConverter<string> {
    convert(value: string): Result<string> {
        return Result.ok(value);
    }
    convertBack(value: string): Result<string> {
        return Result.ok(value);
    }
}
