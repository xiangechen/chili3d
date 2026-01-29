// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n";

export const CommandPrefix = "command.";

export type CommandKeys = {
    [P in I18nKeys]: P extends `${typeof CommandPrefix}${infer K}` ? K : never;
}[I18nKeys];
