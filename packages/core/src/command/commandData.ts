// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Binding } from "../foundation";
import type { CommandKeys } from "./commandKeys";

export type IconSvg = { type: "svg"; value: string };

export type IconPng = { type: "png"; value: Uint8Array };

export type IconUrl = { type: "url"; value: string };

export type IconPath = { type: "path"; value: string };

export type CommandIcon = string | IconSvg | IconPng | IconUrl | IconPath;

export interface CommandData {
    key: CommandKeys;
    icon: CommandIcon;
    toggle?: Binding;
    helpText?: string;
    helpUrl?: string;
    isApplicationCommand?: boolean;
}
