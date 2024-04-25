// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CommandKeys, ICommand } from ".";
import { I18nKeys } from "../i18n";

const CommandMap = new Map<string, new (...args: any[]) => ICommand>();

export type CommandConstructor = new (...args: any[]) => ICommand;

export interface CommandData {
    name: CommandKeys;
    display: I18nKeys;
    icon: string;
    helpText?: string;
    helpUrl?: string;
}

export function command<T extends CommandConstructor>(commandData: CommandData) {
    return (ctor: T) => {
        CommandMap.set(commandData.name, ctor);
        ctor.prototype.data = commandData;
    };
}

export namespace Command {
    export function getData(command: string | ICommand | CommandConstructor): CommandData | undefined {
        if (typeof command === "string") {
            let c = CommandMap.get(command);
            return c?.prototype.data;
        }
        if (typeof command === "function") {
            return command.prototype.data;
        }
        return Object.getPrototypeOf(command).data;
    }

    export function get(name: CommandKeys): CommandConstructor | undefined {
        return CommandMap.get(name);
    }
}
