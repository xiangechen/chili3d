// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CommandKeys, I18nKeys, Locale } from "chili-core";

export interface AdditionalCommand {
    tabName: I18nKeys;
    groupName: I18nKeys;
    command: CommandKeys;
}

export interface IAdditionalModule {
    i18n(): Locale[];
    ribbonCommands(): AdditionalCommand[];
}
