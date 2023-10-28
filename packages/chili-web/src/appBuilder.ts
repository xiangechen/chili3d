// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Application, CommandService, EditorService, HotkeyService } from "chili";
import { IService, IStorage, Logger } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { IVisualFactory } from "chili-vis";

export class AppBuilder {
    #useUI: boolean = false;
    #inits: (() => Promise<void>)[] = [];
    #storage?: IStorage;
    #visualFactory?: IVisualFactory;
    #shapeFactory?: IShapeFactory;

    useIndexedDB() {
        this.#inits.push(async () => {
            Logger.info("initializing IndexedDBStorage");

            let db = await import("chili-storage");
            this.#storage = new db.IndexedDBStorage();
        });
        return this;
    }

    useOcc(): this {
        this.#inits.push(async () => {
            Logger.info("initializing occ");

            let occ = await import("chili-occ");
            await occ.initMyOcc();
            this.#shapeFactory = new occ.ShapeFactory();
        });
        return this;
    }

    useThree(): this {
        this.#inits.push(async () => {
            Logger.info("initializing three");

            let three = await import("chili-three");
            this.#visualFactory = new three.ThreeVisulFactory();
        });
        return this;
    }

    useUI(): this {
        this.#useUI = true;
        return this;
    }

    async build(): Promise<void> {
        for (const init of this.#inits) {
            await init();
        }
        this.ensureNecessary();

        let app = Application.build(
            this.#visualFactory!,
            this.#shapeFactory!,
            this.getServices(),
            this.#storage!,
        );
        await this.loadUI(app);

        Logger.info("Application build completed");
    }

    private ensureNecessary() {
        if (this.#shapeFactory === undefined) {
            throw new Error("ShapeFactory not set");
        }
        if (this.#visualFactory === undefined) {
            throw new Error("VisualFactory not set");
        }
        if (this.#storage === undefined) {
            throw new Error("storage has not been initialized");
        }
    }

    private async loadUI(app: Application) {
        if (this.#useUI) {
            let ui = await import("chili-ui");
            ui.MainWindow.instance.init(app);
        }
    }

    private getServices(): IService[] {
        return [CommandService.instance, HotkeyService.instance, EditorService.instance];
    }
}
