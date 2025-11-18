// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "../application";
import type { CommandKeys } from "../command";
import type { I18nKeys } from "../i18n";
import type { Button } from "./button";

export interface IWindow extends HTMLElement {
    init(app: IApplication): Promise<void>;
    registerHomeCommand(groupName: I18nKeys, command: CommandKeys | Button): void;
    registerRibbonCommand(tabName: I18nKeys, groupName: I18nKeys, command: CommandKeys | Button): void;
}
