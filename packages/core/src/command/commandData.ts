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
    /**
     * Whether the command runs no matter what is going on: it is not queued behind the command
     * in flight (nor does it cancel it), and it does not require an active view — an
     * always-available command handles a missing document itself. It supersedes
     * `isApplicationCommand`, which only lifts the active-view requirement for a command that
     * still waits its turn. Reserve it for work the user must never lose access to — saving
     * the document, downloading it — not for ordinary commands.
     *
     * Running beside a command also means reading the document as it stands at that moment: a
     * save taken while another command is mid-transaction can capture changes it has not
     * committed yet. That is the deliberate trade for never refusing a save.
     */
    alwaysAvailable?: boolean;
}
