// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
