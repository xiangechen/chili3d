// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "./result";

export interface IConverter<TFrom = unknown, TTo = string> {
    convert(value: TFrom): Result<TTo>;
    convertBack?(value: TTo): Result<TFrom>;
}
