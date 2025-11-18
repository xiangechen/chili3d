// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type CommandKeys, type IApplication, type IService, Logger, PubSub } from "chili-core";

export interface Keys {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export interface HotkeyMap {
    [key: string]: CommandKeys;
}

const DefaultKeyMap: HotkeyMap = {
    Delete: "modify.deleteNode",
    Backspace: "modify.deleteNode",
    " ": "special.last",
    Enter: "special.last",
    "ctrl+z": "edit.undo",
    "ctrl+y": "edit.redo",
};

export class HotkeyService implements IService {
    private app?: IApplication;
    private readonly _keyMap = new Map<string, CommandKeys>();

    constructor() {
        this.addMap(DefaultKeyMap);
    }

    register(app: IApplication): void {
        this.app = app;
        Logger.info(`${HotkeyService.name} registed`);
    }

    start(): void {
        window.addEventListener("keydown", this.eventHandlerKeyDown);
        window.addEventListener("keydown", this.commandKeyDown);
        Logger.info(`${HotkeyService.name} started`);
    }

    stop(): void {
        window.removeEventListener("keydown", this.eventHandlerKeyDown);
        window.removeEventListener("keydown", this.commandKeyDown);
        Logger.info(`${HotkeyService.name} stoped`);
    }

    protected canHandleKey(e: KeyboardEvent): boolean {
        return true;
    }

    private readonly eventHandlerKeyDown = (e: KeyboardEvent) => {
        if (!this.canHandleKey(e)) return;

        e.preventDefault();
        const visual = this.app?.activeView?.document?.visual;
        const view = this.app?.activeView;
        if (view && visual) {
            if (visual.eventHandler.isEnabled) visual.eventHandler.keyDown(view, e);
            if (visual.viewHandler.isEnabled) visual.viewHandler.keyDown(view, e);
            if (this.app!.executingCommand) e.stopImmediatePropagation();
        }
    };

    private readonly commandKeyDown = (e: KeyboardEvent) => {
        if (!this.canHandleKey(e)) return;

        e.preventDefault();
        const command = this.getCommand(e);
        if (command !== undefined) {
            PubSub.default.pub("executeCommand", command);
        }
    };

    getKey(keys: Keys): string {
        let key = keys.key;
        if (keys.ctrlKey) key = "ctrl+" + key;
        if (keys.shiftKey) key = "shift+" + key;
        if (keys.altKey) key = "alt+" + key;
        return key;
    }

    map(command: CommandKeys, keys: Keys) {
        const key = this.getKey(keys);
        this._keyMap.set(key, command);
    }

    getCommand(keys: Keys): CommandKeys | undefined {
        const key = this.getKey(keys);
        return this._keyMap.get(key);
    }

    addMap(map: HotkeyMap) {
        const keys = Object.keys(map);
        keys.forEach((key) => {
            this._keyMap.set(key, map[key]);
        });
    }
}
