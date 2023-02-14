import { Commands, Container, ICommand, Logger, PubSub, Token } from "chili-core";
import { Contextual } from "chili-ui";

import { Application } from "./application";
import { Hotkey } from "./hotkey";

export class Executor {
    static _instance: Executor | undefined;

    static get instance() {
        if (Executor._instance === undefined) {
            Executor._instance = new Executor();
        }
        return Executor._instance;
    }

    private _lastCommand: keyof Commands | undefined;
    private _excutingCommand: keyof Commands | undefined;
    private app: Application | undefined;

    private constructor() {
        PubSub.default.sub("excuteCommand", this.excuteCommand);
        PubSub.default.sub("keyDown", this.handleKeyDown);
    }

    register(app: Application) {
        this.app = app;
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        let command = Hotkey.instance.getCommand(e);
        if (command === Hotkey.instance.LastCommand) command = this._lastCommand;
        if (command !== undefined) this.excuteCommand(command);
    };

    private excuteCommand = async (commandName: keyof Commands) => {
        if (this.app === undefined) {
            throw "Executor is not initialized";
        }
        if (this.app.activeDocument === undefined || this._excutingCommand !== undefined) return;
        this._excutingCommand = commandName;
        Logger.info(`excuting command ${commandName}`);
        let command = Application.instance.resolve.resolve<ICommand>(new Token(Commands.instance[commandName]));
        if (command === undefined || command.excute === undefined) {
            Logger.error(`Attempted to resolve unregistered dependency token: ${commandName}`);
            return;
        }
        Contextual.instance.registerControls(command);
        await command.excute(this.app.activeDocument);
        Contextual.instance.clearControls();
        this._lastCommand = commandName;
        this._excutingCommand = undefined;
    };
}
