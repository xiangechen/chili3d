// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "./result";

export interface IConverter<TFrom = any, TTo = string> {
    convert(value: TFrom): Result<TTo>;
    convertBack?(value: TTo): Result<TFrom>;
}
