// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "../base";

export interface IConverter<TFrom = any, TTo = string> {
    convert(value: TFrom): Result<TTo>;
    convertBack(value: TTo): Result<TFrom>;
}
