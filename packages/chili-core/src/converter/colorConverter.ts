// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Color, Result } from "../base";
import { IConverter } from "./converter";

export class ColorConverter implements IConverter<Color> {
    convert(value: Color): Result<string> {
        return Result.success(value.toHexStr());
    }

    convertBack(value: string): Result<Color> {
        return Color.fromHexStr(value);
    }
}
