// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, Commands, Lazy, Logger, PubSub, IService } from "chili-core";

export interface Keys {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export interface HotkeyMap {
    [key: string]: keyof Commands;
}

const DefaultKeyMap: HotkeyMap = {
    Delete: "Delete",
    Backspace: "Delete",
    "ctrl+z": "Undo",
    "ctrl+y": "Redo",
    "ctrl+d": "CopyInplace",
};

export class HotkeyService implements IService {
    private static readonly _lazy = new Lazy(() => new HotkeyService());

    static get instance() {
        return this._lazy.value;
    }

    private app?: Application;
    private readonly _keyMap = new Map<string, keyof Commands>();

    private constructor() {
        this._keyMap.set(" ", "LastCommand");
        this._keyMap.set("Enter", "LastCommand");
        this.addMap(DefaultKeyMap);
    }

    register(app: Application): void {
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
            PubSub.default.pub("excuteCommand", command);
        }
    };

    getKey(keys: Keys): string {
        let key = keys.key;
        if (keys.ctrlKey) key = "ctrl+" + key;
        if (keys.shiftKey) key = "shift+" + key;
        if (keys.altKey) key = "alt+" + key;
        return key;
    }

    map(command: keyof Commands, keys: Keys) {
        let key = this.getKey(keys);
        this._keyMap.set(key, command);
    }

    getCommand(keys: Keys): keyof Commands | undefined {
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
