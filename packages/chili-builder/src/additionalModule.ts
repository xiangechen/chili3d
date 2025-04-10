// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

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
