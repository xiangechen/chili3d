// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, Result } from "chili-core";

export class StringConverter implements IConverter<string> {
    convert(value: string): Result<string> {
        return Result.ok(value);
    }
    convertBack(value: string): Result<string> {
        return Result.ok(value);
    }
}
