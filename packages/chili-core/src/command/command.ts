// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication } from "../application";

export interface ICommand {
    execute(application: IApplication): Promise<void>;
}

export interface ICanclableCommand extends ICommand {
    cancel(): Promise<void>;
}

export namespace ICommand {
    export function isCanclableCommand(command: ICommand): command is ICanclableCommand {
        return "cancel" in command;
    }
}
