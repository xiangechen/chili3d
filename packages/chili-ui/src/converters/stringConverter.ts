// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IConverter, Result } from "chili-core";

export class StringConverter implements IConverter<string> {
    convert(value: string): Result<string> {
        return Result.ok(value);
    }
    convertBack(value: string): Result<string> {
        return Result.ok(value);
    }
}
