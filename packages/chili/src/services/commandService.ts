// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Command, CommandKeys, IApplication, ICommand, IService, IView, Logger, PubSub } from "chili-core";

const ApplicationCommands: CommandKeys[] = ["doc.new", "doc.open", "doc.save"];

export class CommandService implements IService {
    private _lastCommand: CommandKeys | undefined;
    private _checking: boolean = false;
    private _app: IApplication | undefined;

    private get app(): IApplication {
        if (this._app === undefined) {
            throw new Error("Executor is not initialized");
        }
        return this._app;
    }

    start(): void {
        PubSub.default.sub("executeCommand", this.executeCommand);
        PubSub.default.sub("activeViewChanged", this.onActiveViewChanged);
        Logger.info(`${CommandService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("executeCommand", this.executeCommand);
        PubSub.default.remove("activeViewChanged", this.onActiveViewChanged);
        Logger.info(`${CommandService.name} stoped`);
    }

    register(app: IApplication) {
        this._app = app;
        Logger.info(`${CommandService.name} registed`);
    }

    private readonly onActiveViewChanged = async (view: IView | undefined) => {
        if (this.app.executingCommand && ICommand.isCancelableCommand(this.app.executingCommand))
            await this.app.executingCommand.cancel();
    };

    private readonly executeCommand = async (commandName: CommandKeys) => {
        const command = commandName === "special.last" ? this._lastCommand : commandName;
        if (!command || !(await this.canExecute(command))) return;
        Logger.info(`executing command ${command}`);
        await this.executeAsync(command);
    };

    private async executeAsync(commandName: CommandKeys) {
        const commandCtor = Command.get(commandName)!;
        const command = new commandCtor();
        this.app.executingCommand = command;
        PubSub.default.pub("showProperties", this.app.activeView?.document!, []);
        try {
            await command.execute(this.app);
        } catch (err) {
            PubSub.default.pub("displayError", err as string);
            Logger.error(err);
        } finally {
            this._lastCommand = commandName;
            this.app.executingCommand = undefined;
        }
    }

    private async canExecute(commandName: CommandKeys) {
        if (this._checking) return false;
        this._checking = true;
        const result = await this.checking(commandName);
        this._checking = false;
        return result;
    }

    private async checking(commandName: CommandKeys) {
        if (!Command.get(commandName)) {
            Logger.error(`Can not find ${commandName} command`);
            return false;
        }
        if (!ApplicationCommands.includes(commandName) && this.app.activeView === undefined) {
            Logger.error("No active document");
            return false;
        }
        if (!this.app.executingCommand) {
            return true;
        }
        if (Command.getData(this.app.executingCommand)?.key === commandName) {
            PubSub.default.pub("showToast", "toast.command.{0}excuting", commandName);
            return false;
        }
        if (ICommand.isCancelableCommand(this.app.executingCommand)) {
            await this.app.executingCommand.cancel();
            return true;
        }
        return false;
    }
}
