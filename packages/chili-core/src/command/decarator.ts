// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Commands, ICommand } from ".";
import { I18nKeys } from "../i18n";

const CommandMap = new Map<string, new (...args: any[]) => ICommand>();

export type CommandConstructor = new (...args: any[]) => ICommand;

export interface CommandData {
    name: Commands;
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
        } else if (typeof command === "function") {
            return command.prototype.data;
        } else {
            return Object.getPrototypeOf(command).data;
        }
    }

    export function get(name: Commands): CommandConstructor | undefined {
        return CommandMap.get(name);
    }
}
