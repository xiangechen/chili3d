// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18nKeys } from "../i18n";

export enum ButtonSize {
    large,
    small,
}

export interface Button {
    display: I18nKeys;
    icon: string;
    size: ButtonSize;
    onClick: () => void;
}
