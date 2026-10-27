// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    CommandStore,
    errorText,
    I18n,
    type I18nKeys,
    type IApplication,
    type IService,
    type IView,
    isCancelableCommand,
    Logger,
    PubSub,
    pendingWork,
} from "@chili3d/core";

/** The name a command shows in the UI, for a message that has to name it. */
function commandLabel(key: string): string {
    return I18n.translate(`command.${key}` as I18nKeys);
}

export class CommandService implements IService {
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
        if (this.app.executingCommand && isCancelableCommand(this.app.executingCommand))
            await this.app.executingCommand.cancel();
    };

    private readonly executeCommand = async (commandName: CommandKeys) => {
        // A command is the app's unit of "work in flight": a scripted run waits on this
        // rather than on a timer (see `pendingWork`). The release covers the whole call,
        // including the cancellation path below.
        const released = pendingWork.begin();
        try {
            await this.runCommand(commandName);
        } catch (error) {
            // Reaches here when the check itself failed — a cancel that rejects, say —
            // rather than the command's own run, which `executeAsync` reports.
            PubSub.default.pub("displayError", errorText(error));
            Logger.error(error);
        } finally {
            released();
        }
    };

    private async runCommand(commandName: CommandKeys) {
        const command = commandName === "special.last" ? this.app.lastCommand : commandName;
        if (!command || !(await this.canExecute(command))) return;
        Logger.info(`executing command ${command}`);
        await this.executeAsync(command);
    }

    private async executeAsync(commandName: CommandKeys) {
        const commandCtor = CommandStore.getCommand(commandName)!;
        if (!commandCtor) {
            Logger.error(`Can not find ${commandName} command`);
            return;
        }

        // An `alwaysAvailable` command (save, download) runs BESIDE whatever is in flight
        // rather than taking its place: it neither claims `executingCommand` — the running
        // command still owns that slot, and clearing it here would strand its cancel path —
        // nor clears the property panel the running command is using. A command that must not
        // run twice at once guards that itself: its `execute` often only starts a spinner and
        // returns, so "in flight" is longer than this call (see `SaveDocument`).
        const alwaysAvailable = CommandStore.getComandData(commandName)?.alwaysAvailable === true;

        const command = new commandCtor();
        if (!alwaysAvailable) {
            this.app.executingCommand = command;
            PubSub.default.pub("showProperties", this.app.activeView?.document!, []);
        }

        await Promise.try(command.execute.bind(command), this.app)
            .catch((err) => {
                PubSub.default.pub("displayError", errorText(err));
                Logger.error(err);
            })
            .finally(() => {
                this.app.lastCommand = commandName;
                if (!alwaysAvailable) this.app.executingCommand = undefined;
            });
    }

    private async canExecute(commandName: CommandKeys) {
        // An `alwaysAvailable` command neither queues nor needs a view: the queue below can
        // wait on a cancel that never settles, and a refused command is silent — a save click
        // during another command used to do nothing at all. It runs now, and handles a
        // missing document itself (see `CommandData.alwaysAvailable`).
        if (CommandStore.getComandData(commandName)?.alwaysAvailable === true) return true;

        if (this._checking) return false;
        this._checking = true;
        try {
            return await this.checking(commandName);
        } finally {
            // A throwing check (e.g. a `cancel()` that rejects) used to leave the flag set,
            // which silently refused every later command for the rest of the session.
            this._checking = false;
        }
    }

    private async checking(commandName: CommandKeys) {
        const commandData = CommandStore.getComandData(commandName);
        if (!commandData?.isApplicationCommand && this.app.activeView === undefined) {
            Logger.error("No active document");
            return false;
        }
        if (!this.app.executingCommand) {
            return true;
        }
        const runningCommand = this.app.executingCommand;
        const runningKey = CommandStore.getComandData(runningCommand)?.key;
        if (runningKey === commandName) {
            PubSub.default.pub("showToast", "toast.command.{0}excuting", commandLabel(commandName));
            return false;
        }
        if (isCancelableCommand(runningCommand)) {
            await runningCommand.cancel();
            return true;
        }
        // A non-cancelable command cannot be interrupted, and refusing to start a command on
        // top of it used to happen without a word — indistinguishable from a broken button.
        PubSub.default.pub("showToast", "toast.command.{0}excuting", commandLabel(runningKey ?? commandName));
        return false;
    }
}
