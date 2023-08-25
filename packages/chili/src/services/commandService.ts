// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Command, CommandKeys, I18n, IApplication, IService, Lazy, Logger, PubSub } from "chili-core";

const ApplicationCommands: CommandKeys[] = ["doc.new", "doc.open", "doc.save"];

export class CommandService implements IService {
    private static readonly _lazy = new Lazy(() => new CommandService());

    static get instance() {
        return this._lazy.value;
    }

    private _lastCommand: CommandKeys | undefined;
    private _executingCommand: CommandKeys | undefined;

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
        if (!this.canExecute(command)) return;
        Logger.info(`executing command ${command}`);
        await this.executeAsync(command);
    };

    private async executeAsync(commandName: CommandKeys) {
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

    private canExecute(commandName: CommandKeys) {
        if (!Command.get(commandName)) {
            Logger.error(`Can not find ${commandName} command`);
            return false;
        }
        if (ApplicationCommands.includes(commandName)) return true;
        if (this._executingCommand) {
            let excuting = Command.getData(this._executingCommand)!;
            PubSub.default.pub("showToast", "toast.command.{0}excuting", I18n.translate(excuting.display));
            Logger.warn(`command ${this._executingCommand} is executing`);
            return false;
        }
        if (this.app.activeDocument === undefined) {
            Logger.error("No active document");
            return false;
        }

        return true;
    }
}
