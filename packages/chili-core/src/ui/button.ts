// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys } from "../command";
import type { I18nKeys } from "../i18n";

export enum ButtonSize {
    large,
    small,
}

export interface Button {
    command: CommandKeys;
    display?: I18nKeys;
    icon: string;
    size: ButtonSize;
    onClick: () => void;
}
