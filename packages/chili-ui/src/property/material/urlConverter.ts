// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IConverter, Result } from "chili-core";

export class UrlStringConverter implements IConverter<string> {
    convert(value: string): Result<string> {
        return Result.ok(`url('${value}')`);
    }
}
