// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
