// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { Result } from "./result";

export interface IConverter<TFrom = unknown, TTo = string> {
    convert(value: TFrom): Result<TTo>;
    convertBack?(value: TTo): Result<TFrom>;
}
