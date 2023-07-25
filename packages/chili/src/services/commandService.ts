// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, Commands, ICommand, IService, Lazy, Logger, PubSub, Token } from "chili-core";
import { NewDocument, OpenDocument } from "../commands";

export class CommandService implements IService {
    private static readonly _lazy = new Lazy(() => new CommandService());

    static get instance() {
        return this._lazy.value;
    }

    private _lastCommand: keyof Commands | undefined;
    private _executingCommand: keyof Commands | undefined;

    private _app: Application | undefined;

    private get app(): Application {
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

    register(app: Application) {
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
        let command = this.app.resolve.resolve<ICommand>(new Token(commandName))!;
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

    private canExecute(commandName: string) {
        if (this._executingCommand) {
            Logger.warn(`command ${this._executingCommand} is executing`);
            return false;
        }
        if (
            ![OpenDocument.name, NewDocument.name].includes(commandName) &&
            this.app.activeDocument === undefined
        ) {
            Logger.error("No active document");
            return false;
        }
        if (!this.app.resolve.has(new Token(commandName))) {
            Logger.error(`Unregistered dependency token: ${commandName}`);
            return false;
        }
        return true;
    }
}
