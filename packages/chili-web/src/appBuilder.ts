// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Application,
    CommandData,
    Container,
    IRegister,
    IService,
    IStorage,
    Logger,
    Token,
} from "chili-core";
import { CommandService, EditorService, HotkeyService } from "chili";

export class AppBuilder {
    private _inits: (() => Promise<void>)[];
    private _register: IRegister = new Container();
    private _storage?: IStorage;

    private storage() {
        if (this._storage === undefined) {
            throw new Error("storage has not been initialized");
        }
        return this._storage;
    }

    constructor() {
        this._inits = [];
        this.registerCommands();
    }

    useIndexedDB() {
        this._inits.push(async () => {
            Logger.info("initializing IndexedDBStorage");

            let db = await import("chili-storage");
            this._storage = new db.IndexedDBStorage();
        });
        return this;
    }

    useOcc(): this {
        this._inits.push(async () => {
            Logger.info("initializing occ");

            let occ = await import("chili-occ");
            await new occ.OccModule().init(this._register);
        });
        return this;
    }

    useThree(): this {
        this._inits.push(async () => {
            Logger.info("initializing three");

            let three = await import("chili-three");
            await new three.ThreeModule().init(this._register);
        });
        return this;
    }

    useUI(): this {
        this._inits.push(async () => {
            Logger.info("initializing UI");

            const root = document.getElementById("root");
            if (root === null) {
                throw new Error("root element not found");
            }

            let ui = await import("chili-ui");
            ui.UI.instance.init(this.storage(), root);
        });
        return this;
    }

    private registerCommands() {
        this._inits.push(async () => {
            Logger.info("initializing commands");

            let commands: any = await import("chili");
            let keys = Object.keys(commands);
            for (const element of keys) {
                let command = commands[element];
                let data = CommandData.get(command);
                if (command.prototype?.excute !== undefined && data !== undefined) {
                    this._register.register(new Token(data.name), command);
                }
            }
        });
    }

    async build(): Promise<void> {
        for (const element of this._inits) {
            await element();
        }
        let services = this.getServices();
        Application.build(this._register.createResolve(), services, this.storage());

        Logger.info("Application build completed");
    }

    private getServices(): IService[] {
        return [CommandService.instance, HotkeyService.instance, EditorService.instance];
    }
}
