// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Command,
    Commands,
    IApplication,
    ICommand,
    IService,
    Lazy,
    Logger,
    PubSub,
    Token,
} from "chili-core";
import { NewDocument, OpenDocument } from "../commands";

export class CommandService implements IService {
    private static readonly _lazy = new Lazy(() => new CommandService());

    static get instance() {
        return this._lazy.value;
    }

    private _lastCommand: keyof Commands | undefined;
    private _executingCommand: keyof Commands | undefined;

    private _app: IApplication | undefined;

    private get app(): IApplication {
        if (this._app === undefined) {
            throw new Error("Executor is not initialized");
        }
        return this._app;
    }

    private constructor() {}

    start(): void {
        PubSub.default.sub("executeCommand", this.executeCommand);
        Logger.info(`${CommandService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("executeCommand", this.executeCommand);
        Logger.info(`${CommandService.name} stoped`);
    }

    register(app: IApplication) {
        this._app = app;
        Logger.info(`${CommandService.name} registed`);
    }

    get isExcuting(): boolean {
        return this._executingCommand !== undefined;
    }

    private executeCommand = async (commandName: keyof Commands) => {
        let command = commandName === "LastCommand" ? this._lastCommand : commandName;
        if (command === undefined) return;
        if (!this.canExecute(command)) return;
        Logger.info(`executing command ${command}`);
        await this.executeAsync(command);
    };

    private async executeAsync(commandName: keyof Commands) {
        let commandCtor = Command.get(commandName)!;
        let command = new commandCtor();
        this._executingCommand = commandName;
        await command
            .execute(this.app)
            .catch((err) => {
                Logger.error(err);
            })
            .finally(() => {
                this._lastCommand = commandName;
                this._executingCommand = undefined;
            });
    }

    private canExecute(commandName: keyof Commands) {
        if (this._executingCommand) {
            PubSub.default.pub("showToast", "toast.command.excuting");
            Logger.warn(`command ${this._executingCommand} is executing`);
            return false;
        }
        let appCommands: (keyof Commands)[] = ["OpenDocument", "NewDocument"];
        if (!appCommands.includes(commandName) && this.app.activeDocument === undefined) {
            Logger.error("No active document");
            return false;
        }
        if (!Command.get(commandName)) {
            Logger.error(`Can not find ${commandName} command`);
            return false;
        }
        return true;
    }
}
