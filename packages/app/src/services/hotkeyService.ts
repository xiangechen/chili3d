// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    CommandStore,
    Config,
    type IApplication,
    type IService,
    Logger,
    PubSub,
    ShortcutProfiles,
} from "@chili3d/core";

export interface Keys {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export interface HotkeyMap {
    [key: string]: CommandKeys;
}

/**
 * The map key for a key sequence with modifiers, e.g. "ctrl+shift+s". Modifiers go in the
 * order `ShortcutProfiles` writes them — ctrl, shift, alt — or a shortcut spelled
 * "ctrl+shift+z" would never match the "shift+ctrl+z" this built. Both lookups below must
 * spell it the same way, or a shortcut silently stops matching in one path only.
 */
function formatChord(key: string, modifiers: Omit<Keys, "key">): string {
    let prefix = "";
    if (modifiers.ctrlKey) prefix += "ctrl+";
    if (modifiers.shiftKey) prefix += "shift+";
    if (modifiers.altKey) prefix += "alt+";
    return prefix + key;
}

export class HotkeyService implements IService {
    protected keys: string[] = [];
    private app?: IApplication;
    private readonly _keyMap = new Map<string, CommandKeys>();

    constructor() {
        this.loadProfile();
    }

    private loadProfile() {
        const profile = Config.instance.navigation3D;
        const shortcuts = ShortcutProfiles[profile];

        this._keyMap.clear();

        for (const [command, keyOrKeys] of Object.entries(shortcuts)) {
            if (Array.isArray(keyOrKeys)) {
                keyOrKeys.forEach((k) => this._keyMap.set(k.toLowerCase(), command as CommandKeys));
            } else if (typeof keyOrKeys === "string") {
                this._keyMap.set(keyOrKeys.toLowerCase(), command as CommandKeys);
            }
        }
        Logger.info(`Loaded shortcuts profile: ${profile}`);
    }

    register(app: IApplication): void {
        this.app = app;
        Logger.info(`${HotkeyService.name} registed`);
    }

    start(): void {
        PubSub.default.sub("executeCommand", this.executeCommand);
        window.addEventListener("keydown", this.eventHandlerKeyDown);
        window.addEventListener("keydown", this.commandKeyDown);
        Config.instance.onPropertyChanged(this.handleConfigChanged);
        Logger.info(`${HotkeyService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("executeCommand", this.executeCommand);
        window.removeEventListener("keydown", this.eventHandlerKeyDown);
        window.removeEventListener("keydown", this.commandKeyDown);
        Config.instance.removePropertyChanged(this.handleConfigChanged);
        Logger.info(`${HotkeyService.name} stoped`);
    }

    private readonly executeCommand = (_commandName: CommandKeys) => {
        this.keys = [];
    };

    private readonly handleConfigChanged = (prop: keyof Config) => {
        if (prop === "navigation3D") {
            this.loadProfile();
        }
    };

    protected canHandleKey(e: KeyboardEvent): boolean {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
            return false;
        }
        return true;
    }

    /**
     * The command one chord maps to, read without the key-sequence bookkeeping `getCommand`
     * does — a key typed into a text box must not become part of a multi-key shortcut.
     */
    private chordCommand(e: KeyboardEvent): CommandKeys | undefined {
        const chord = formatChord(e.key.toLowerCase(), {
            ctrlKey: e.ctrlKey || e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
        });
        return this._keyMap.get(chord);
    }

    private isAlwaysAvailableChord(e: KeyboardEvent): boolean {
        const command = this.chordCommand(e);
        return command !== undefined && CommandStore.getComandData(command)?.alwaysAvailable === true;
    }

    private readonly eventHandlerKeyDown = (e: KeyboardEvent) => {
        if (!this.canHandleKey(e)) return;

        const visual = this.app?.activeView?.document?.visual;
        const view = this.app?.activeView;
        if (view && visual) {
            if (visual.eventHandler.isEnabled) visual.eventHandler.keyDown(view, e);
            if (visual.viewHandler.isEnabled) visual.viewHandler.keyDown(view, e);
        }
    };

    private readonly commandKeyDown = (e: KeyboardEvent) => {
        // A focused text box keeps every shortcut a text box can use (Ctrl+Z and friends),
        // but saving has no meaning there: Ctrl+S must save wherever the caret is.
        if (!this.canHandleKey(e) && !this.isAlwaysAvailableChord(e)) return;

        const keys: Keys = {
            key: e.key.toLowerCase(),
            ctrlKey: e.ctrlKey || e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
        };

        const command = this.getCommand(keys);
        if (command !== undefined) {
            e.preventDefault();
            e.stopImmediatePropagation();
            PubSub.default.pub("executeCommand", command);
        }
    };

    getCommand(keys: Keys): CommandKeys | undefined {
        const maxKeyLength = 20;
        const totleLength = this.keys.length + keys.key.length;
        if (totleLength > maxKeyLength) {
            this.keys = this.keys.slice(totleLength - maxKeyLength);
        }
        this.keys.push(keys.key);

        for (let i = 0; i < this.keys.length; i++) {
            const key = formatChord(this.keys.slice(i).join("+"), keys);
            if (this._keyMap.has(key)) {
                return this._keyMap.get(key);
            }
        }
        return undefined;
    }

    addMap(map: HotkeyMap) {
        const keys = Object.keys(map);
        keys.forEach((key) => {
            this._keyMap.set(key.toLowerCase(), map[key]);
        });
    }
}
