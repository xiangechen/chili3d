// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata"; // 使用依赖注入时，必须导入
import { Token, Logger, Container } from "chili-shared";
import { ICommand, Hotkey, CommandData } from "chili-core";
import hotkey from "./hotkeys.json";
import ribbon from "./ribbon.json";
import quickbar from "./quickbar.json";
import { Application } from "./application";
import { Executor } from "./executor";

export class AppBuilder {
    private _inits: (() => Promise<void>)[];
    private _app: Application;

    constructor() {
        this._inits = [];
        this._app = Application.current;
        this.registerCommands();
        this.registerHotkeys();
        this.registerExecutor();
    }

    useOcc(): AppBuilder {
        this._inits.push(async () => {
            Logger.info("initializing occ");

            let occ = await import("chili-occ");
            await new occ.OccModule().init(Container.default);
        });
        return this;
    }

    useThree(): AppBuilder {
        this._inits.push(async () => {
            Logger.info("initializing three");

            let three = await import("chili-three");
            await new three.ThreeModule().init(Container.default);
        });
        return this;
    }

    useUI(): AppBuilder {
        this._inits.push(async () => {
            Logger.info("initializing UI");

            let ui = await import("chili-ui");
            ui.UI.instance.init(document.getElementById("root")!, ribbon, quickbar);
        });
        return this;
    }

    private registerCommands() {
        this._inits.push(async () => {
            Logger.info("initializing commands");

            let commands: any = await import("./commands");
            let keys = Object.keys(commands);
            for (let index = 0; index < keys.length; index++) {
                let command = commands[keys[index]];
                let data = CommandData.get(command);
                if (command.prototype?.excute !== undefined && data !== undefined) {
                    Container.default.register<ICommand>(new Token(data.name), command);
                }
            }
        });
    }

    private registerHotkeys() {
        this._inits.push(async () => {
            Logger.info("initializing hotkeys");

            Hotkey.instance.registerFrom(hotkey);
        });
    }

    private registerExecutor() {
        this._inits.push(async () => {
            Logger.info("initializing executor");

            Executor.instance.register(this._app);
        });
    }

    async build(): Promise<Application> {
        for (let index = 0; index < this._inits.length; index++) {
            await this._inits[index]();
        }

        return this._app;
    }
}
