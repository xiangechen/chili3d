// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { CommandKeys } from "../command";
import { I18nKeys } from "../i18n";

export type RibbonGroup = {
    groupName: I18nKeys;
    items: (CommandKeys | CommandKeys[])[];
};

export type RibbonTab = {
    tabName: I18nKeys;
    groups: RibbonGroup[];
};
