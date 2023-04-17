// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, Container, ICommand, IRegister, Logger, Token } from "chili-core";

import {
    Application,
    CommandService,
    EditorService,
    HotkeyService,
    IApplicationService,
    TreeService,
} from "chili";

export class AppBuilder {
    private _inits: (() => Promise<void>)[];
    private _register: IRegister = new Container();

    constructor() {
        this._inits = [];
        this.registerCommands();
    }

    useOcc(): AppBuilder {
        this._inits.push(async () => {
            Logger.info("initializing occ");

            let occ = await import("chili-occ");
            await new occ.OccModule().init(this._register);
        });
        return this;
    }

    useThree(): AppBuilder {
        this._inits.push(async () => {
            Logger.info("initializing three");

            let three = await import("chili-three");
            await new three.ThreeModule().init(this._register);
        });
        return this;
    }

    useUI(): AppBuilder {
        this._inits.push(async () => {
            Logger.info("initializing UI");

            let ui = await import("chili-ui");
            // ui.UI.instance.init(document.getElementById("root")!);
            let layout = new ui.UI();
            layout.render();
        });
        return this;
    }

    private registerCommands() {
        this._inits.push(async () => {
            Logger.info("initializing commands");

            let commands: any = await import("chili");
            let keys = Object.keys(commands);
            for (let index = 0; index < keys.length; index++) {
                let command = commands[keys[index]];
                let data = CommandData.get(command);
                if (command.prototype?.excute !== undefined && data !== undefined) {
                    this._register.register<ICommand>(new Token(data.name), command);
                }
            }
        });
    }

    async build(): Promise<void> {
        for (let index = 0; index < this._inits.length; index++) {
            await this._inits[index]();
        }
        let services = this.getServices();
        Application.build(this._register.createResolve(), services);

        Logger.info("Application build completed");
    }

    private getServices(): IApplicationService[] {
        return [
            CommandService.instance,
            HotkeyService.instance,
            EditorService.instance,
            TreeService.instance,
        ];
    }
}
