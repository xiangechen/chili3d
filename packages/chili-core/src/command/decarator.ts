// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Binding } from "../foundation";
import type { ICommand } from "./command";
import type { CommandKeys } from "./commandKeys";

const commandRegistry = new Map<string, CommandConstructor>();

export type CommandConstructor = new (...args: any[]) => ICommand;

export interface CommandData {
    key: CommandKeys;
    icon: string;
    toggle?: Binding;
    helpText?: string;
    helpUrl?: string;
    isApplicationCommand?: boolean;
}

export function command<T extends CommandConstructor>(metadata: CommandData) {
    return (ctor: T) => {
        commandRegistry.set(metadata.key, ctor);
        ctor.prototype.data = metadata;
    };
}

export class CommandUtils {
    static getComandData(target: string | ICommand | CommandConstructor): CommandData | undefined {
        if (typeof target === "string") {
            const ctor = commandRegistry.get(target);
            return ctor?.prototype.data;
        }

        const prototype = typeof target === "function" ? target.prototype : Object.getPrototypeOf(target);

        return prototype.data;
    }

    static getCommond(name: CommandKeys): CommandConstructor | undefined {
        return commandRegistry.get(name);
    }

    static getAllCommands(): CommandData[] {
        return Array.from(
            commandRegistry
                .values()
                .map((ctor) => ctor.prototype.data)
                .filter((x) => x),
        );
    }
}
