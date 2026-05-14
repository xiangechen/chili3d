// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys } from "../command";
import type { I18nKeys } from "../i18n";

export type ButtonSize = "large" | "small";

export interface PushButton {
    type: "push";
    command: CommandKeys;
    display?: I18nKeys;
    icon: string;
    size: ButtonSize;
    onClick: () => void;
}

export interface PulldownButton {
    type: "pulldown";
    display: I18nKeys;
    icon: string;
    items: (PushButton | CommandKeys)[];
}

export interface SplitButton {
    type: "split";
    items: (PushButton | CommandKeys)[];
}
