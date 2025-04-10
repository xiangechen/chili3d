// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

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
