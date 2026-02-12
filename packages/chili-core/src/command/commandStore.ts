// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Binding } from "../foundation";
import type { ICommand } from "./command";
import type { CommandKeys } from "./commandKeys";

export type CommandConstructor = new (...args: any[]) => ICommand;

export interface CommandData {
    key: CommandKeys;
    icon: string;
    toggle?: Binding;
    helpText?: string;
    helpUrl?: string;
    isApplicationCommand?: boolean;
}

const commandRegistry = new Map<string, CommandConstructor>();

export class CommandStore {
    static registerCommand<T extends CommandConstructor>(
        ctor: T,
        metadata: Omit<CommandData, "key"> & { key: string },
    ) {
        commandRegistry.set(metadata.key, ctor);
        ctor.prototype.data = metadata;
    }

    static unregisterCommand(key: string) {
        const ctor = commandRegistry.get(key);
        if (ctor) {
            delete ctor.prototype.data;
        }
        commandRegistry.delete(key);
    }

    static getComandData(target: string | ICommand | CommandConstructor): CommandData | undefined {
        if (typeof target === "string") {
            const ctor = commandRegistry.get(target);
            return ctor?.prototype.data;
        }

        const prototype = typeof target === "function" ? target.prototype : Object.getPrototypeOf(target);

        return prototype.data;
    }

    static getCommand(name: string): CommandConstructor | undefined {
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
