// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export interface Keys {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export interface HotkeyMap {
    [key: string]: string;
}

export class Hotkey {
    private readonly _keyMap = new Map<string, string>();
    readonly LastCommand = "*LastCommand";

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

    register(command: string, keys: Keys) {
        let key = this.getKey(keys);
        this._keyMap.set(key, command);
    }

    getCommand(keys: Keys): string | undefined {
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
