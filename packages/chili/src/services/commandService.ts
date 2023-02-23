// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Commands, ICommand, Lazy, Logger, PubSub, Token } from "chili-core";
import { Contextual } from "chili-ui";

import { Application } from "../application";
import { IApplicationService } from "./applicationService";

export class CommandService implements IApplicationService {
    private static readonly _lazy = new Lazy(() => new CommandService());

    static get instance() {
        return this._lazy.value;
    }

    private _lastCommand: keyof Commands | undefined;
    private _excutingCommand: keyof Commands | undefined;
    private app: Application | undefined;

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
        this.app = app;
        Logger.info(`${CommandService.name} registed`);
    }

    private excuteCommand = async (commandName: keyof Commands) => {
        if (this.app === undefined) {
            throw "Executor is not initialized";
        }
        if (this.app.activeDocument === undefined || this._excutingCommand !== undefined) return;
        this._excutingCommand = commandName;
        Logger.info(`excuting command ${commandName}`);
        let commandToken = commandName === "LastCommand" ? this._lastCommand : commandName;
        let command = Application.instance.resolve.resolve<ICommand>(new Token(commandToken!));
        if (command === undefined || command.excute === undefined) {
            Logger.error(`Attempted to resolve unregistered dependency token: ${commandName}`);
            return;
        }
        Contextual.instance.registerControls(command);
        await command.excute(this.app.activeDocument);
        Contextual.instance.clearControls();
        this._lastCommand = commandToken;
        this._excutingCommand = undefined;
    };
}
