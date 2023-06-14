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
        Logger.info(`excuting command ${commandName}`);
        if (
            ![OpenDocument.name, NewDocument.name].includes(commandName) &&
            this.app.activeDocument === undefined
        ) {
            Logger.error("No active document");
            return;
        }
        let commandToken = commandName === "LastCommand" ? this._lastCommand : commandName;
        let command = this.app.resolve.resolve<ICommand>(new Token(commandToken!));
        if (command === undefined || command.excute === undefined) {
            Logger.error(`Attempted to resolve unregistered dependency token: ${commandName}`);
            return;
        }
        this._excutingCommand = commandName;
        await command
            .excute(this.app)
            .catch((err) => {
                Logger.error(err);
            })
            .finally(() => {
                this._lastCommand = commandToken;
                this._excutingCommand = undefined;
            });
    };
}
