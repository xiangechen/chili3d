// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, Commands, ICommand, IService, Lazy, Logger, PubSub, Token } from "chili-core";
import { NewDocument, OpenDocument } from "../commands";

export class CommandService implements IService {
    private static readonly _lazy = new Lazy(() => new CommandService());

    static get instance() {
        return this._lazy.value;
    }

    private _lastCommand: keyof Commands | undefined;
    private _excutingCommand: keyof Commands | undefined;

    private _app: Application | undefined;

    private get app(): Application {
        if (this._app === undefined) {
            throw new Error("Executor is not initialized");
        }
        return this._app;
    }

    private constructor() {}

    start(): void {
        PubSub.default.sub("excuteCommand", this.excuteCommand);
        Logger.info(`${CommandService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("excuteCommand", this.excuteCommand);
        Logger.info(`${CommandService.name} stoped`);
    }

    register(app: Application) {
        this._app = app;
        Logger.info(`${CommandService.name} registed`);
    }

    private excuteCommand = async (commandName: keyof Commands) => {
        let command = commandName === "LastCommand" ? this._lastCommand : commandName;
        if (command === undefined) return;
        if (!this.canExcute(command)) return;
        Logger.info(`excuting command ${command}`);
        await this.excuteCommandAsync(command);
    };

    private async excuteCommandAsync(commandName: keyof Commands) {
        let command = this.app.resolve.resolve<ICommand>(new Token(commandName!))!;
        this._excutingCommand = commandName;
        await command
            .excute(this.app)
            .catch((err) => {
                Logger.error(err);
            })
            .finally(() => {
                this._lastCommand = commandName;
                this._excutingCommand = undefined;
            });
    }

    private canExcute(commandName: string) {
        if (this._excutingCommand) {
            Logger.warn(`command ${this._excutingCommand} is excuting`);
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
