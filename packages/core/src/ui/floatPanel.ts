// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n/keys";

export interface FloatPanelOptions {
    title: I18nKeys;
    content: HTMLElement;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    x?: number;
    y?: number;
    onClose?: () => void;
}
