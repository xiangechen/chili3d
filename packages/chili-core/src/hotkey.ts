// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Commands } from "chili-shared";

export interface Keys {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export interface HotkeyMap {
    [key: string]: keyof Commands;
}

export class Hotkey {
    private readonly _keyMap = new Map<string, keyof Commands>();
    readonly LastCommand = "LastCommand";

    private constructor() {
        this._keyMap.set(" ", this.LastCommand);
        this._keyMap.set("Enter", this.LastCommand);
    }

    private static _instance: Hotkey | undefined;

    public static get instance() {
        if (Hotkey._instance === undefined) {
            Hotkey._instance = new Hotkey();
        }
        return Hotkey._instance;
    }

    getKey(keys: Keys): string {
        let key = keys.key;
        if (keys.ctrlKey) key = "ctrl+" + key;
        if (keys.shiftKey) key = "shift+" + key;
        if (keys.altKey) key = "alt+" + key;
        return key;
    }

    register(command: keyof Commands, keys: Keys) {
        let key = this.getKey(keys);
        this._keyMap.set(key, command);
    }

    getCommand(keys: Keys): keyof Commands | undefined {
        let key = this.getKey(keys);
        return this._keyMap.get(key);
    }

    registerFrom(map: HotkeyMap) {
        let keys = Object.keys(map);
        keys.forEach((key) => {
            this._keyMap.set(key, map[key]);
        });
    }
}
