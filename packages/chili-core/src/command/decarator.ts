// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CommandKeys, ICommand } from ".";
import { Binding } from "../foundation";
import { I18nKeys } from "../i18n";

const commandRegistry = new Map<string, CommandConstructor>();

export type CommandConstructor = new (...args: any[]) => ICommand;

export interface CommandData {
    name: CommandKeys;
    display: I18nKeys;
    icon: string;
    toggle?: Binding;
    helpText?: string;
    helpUrl?: string;
}

export function command<T extends CommandConstructor>(metadata: CommandData) {
    return (constructor: T) => {
        commandRegistry.set(metadata.name, constructor);
        constructor.prototype.data = metadata;
    };
}

export namespace Command {
    export function getData(target: string | ICommand | CommandConstructor): CommandData | undefined {
        if (typeof target === "string") {
            const constructor = commandRegistry.get(target);
            return constructor?.prototype.data;
        }

        const prototype = typeof target === "function" ? target.prototype : Object.getPrototypeOf(target);

        return prototype.data;
    }

    export function get(name: CommandKeys): CommandConstructor | undefined {
        return commandRegistry.get(name);
    }
}
