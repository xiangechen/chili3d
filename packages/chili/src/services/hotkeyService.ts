// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CommandKeys, IApplication, IService, Logger, PubSub } from "chili-core";

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
    Delete: "modify.delete",
    Backspace: "modify.delete",
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

    private eventHandlerKeyDown = (e: KeyboardEvent) => {
        e.preventDefault();
        let visual = this.app?.activeDocument?.visual;
        let view = visual?.viewer.activeView;
        if (view && visual) {
            visual.eventHandler.keyDown(view, e);
            visual.viewHandler.keyDown(view, e);
            if (visual.isExcutingHandler()) e.stopImmediatePropagation();
        }
    };

    private commandKeyDown = (e: KeyboardEvent) => {
        e.preventDefault();
        let command = this.getCommand(e);
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
        let key = this.getKey(keys);
        this._keyMap.set(key, command);
    }

    getCommand(keys: Keys): CommandKeys | undefined {
        let key = this.getKey(keys);
        return this._keyMap.get(key);
    }

    addMap(map: HotkeyMap) {
        let keys = Object.keys(map);
        keys.forEach((key) => {
            this._keyMap.set(key, map[key]);
        });
    }
}
