// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Commands, Lazy, Logger, PubSub } from "chili-core";
import { Application } from "../application";
import { IApplicationService } from "./applicationService";

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
    "ctrl+z": "Undo",
    "ctrl+y": "Redo",
};

export class HotkeyService implements IApplicationService {
    private static readonly _lazy = new Lazy(() => new HotkeyService());

    static get instance() {
        return this._lazy.value;
    }

    private readonly _keyMap = new Map<string, keyof Commands>();

    private constructor() {
        this._keyMap.set(" ", "LastCommand");
        this._keyMap.set("Enter", "LastCommand");
        this.addMap(DefaultKeyMap);
    }

    register(app: Application): void {
        Logger.info(`${HotkeyService.name} registed`);
    }

    start(): void {
        PubSub.default.sub("keyDown", this.handleKeyDown);
        Logger.info(`${HotkeyService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("keyDown", this.handleKeyDown);
        Logger.info(`${HotkeyService.name} stoped`);
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        let command = HotkeyService.instance.getCommand(e);
        if (command === undefined) return;
        PubSub.default.pub("excuteCommand", command);
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
