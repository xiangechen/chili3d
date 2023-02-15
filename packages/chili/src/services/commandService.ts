import { Commands, Container, ICommand, Logger, PubSub, Token } from "chili-core";
import { Contextual } from "chili-ui";

import { Application } from "../application";
import { IApplicationService } from "./applicationService";
import { HotkeyService } from "./hotkeyService";

export class CommandService implements IApplicationService {
    static _instance: CommandService | undefined;

    static get instance() {
        if (CommandService._instance === undefined) {
            CommandService._instance = new CommandService();
        }
        return CommandService._instance;
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
