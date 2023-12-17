// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Command, CommandKeys, IApplication, ICommand, IService, Lazy, Logger, PubSub } from "chili-core";

const ApplicationCommands: CommandKeys[] = ["doc.new", "doc.open", "doc.save"];

export class CommandService implements IService {
    private static readonly _lazy = new Lazy(() => new CommandService());

    static get instance() {
        return this._lazy.value;
    }

    private _lastCommand: CommandKeys | undefined;
    private _executingCommand: ICommand | undefined;

    private _app: IApplication | undefined;

    private get app(): IApplication {
        if (this._app === undefined) {
            throw new Error("Executor is not initialized");
        }
        return this._app;
    }

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

    private executeCommand = async (commandName: CommandKeys) => {
        let command = commandName === "special.last" ? this._lastCommand : commandName;
        if (command === undefined) return;
        if (!(await this.canExecute(command))) return;
        Logger.info(`executing command ${command}`);
        await this.executeAsync(command);
    };

    private async executeAsync(commandName: CommandKeys) {
        let commandCtor = Command.get(commandName)!;
        let command = new commandCtor();
        this._executingCommand = command;
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

    private async canExecute(commandName: CommandKeys) {
        if (!Command.get(commandName)) {
            Logger.error(`Can not find ${commandName} command`);
            return false;
        }
        if (this._executingCommand) {
            if (Command.getData(this._executingCommand)?.name === commandName) {
                return false;
            }
            if (ICommand.isCanclableCommand(this._executingCommand)) await this._executingCommand.cancel();
        }
        if (!ApplicationCommands.includes(commandName) && this.app.activeDocument === undefined) {
            Logger.error("No active document");
            return false;
        }

        return true;
    }
}
