import { Hotkey, ICommand, PubSub } from "chili-core";
import { Commands, Container, Logger, Token } from "chili-core";
import { Contextual } from "chili-ui";
import { Application } from "./application";

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

    private constructor() {}

    register(app: Application) {
        this.app = app;
        PubSub.default.sub("excuteCommand", this.excuteCommand);
        PubSub.default.sub("keyDown", this.handleKeyDown);
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        let command = Hotkey.instance.getCommand(e);
        if (command === Hotkey.instance.LastCommand) command = this._lastCommand;
        if (command !== undefined) this.excuteCommand(command);
    };

    private excuteCommand = async (commandName: keyof Commands) => {
        if (this.app === undefined) {
            Logger.error("Executor is not initialized");
            return;
        }
        if (this.app.activeDocument === undefined || this._excutingCommand !== undefined) return;
        this._excutingCommand = commandName;
        Logger.info(`excuting command ${commandName}`);
        let command = Container.default.resolve<ICommand>(new Token(Commands.instance[commandName]));
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
