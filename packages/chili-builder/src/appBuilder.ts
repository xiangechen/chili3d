// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Application, CommandService, EditEventHandler, EditorService, HotkeyService } from "chili";
import { IDocument, INode, IService, IStorage, Logger } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { IVisualFactory } from "chili-vis";

export class AppBuilder {
    private _useUI: boolean = false;
    private _inits: (() => Promise<void>)[] = [];
    private _storage?: IStorage;
    private _visualFactory?: IVisualFactory;
    private _shapeFactory?: IShapeFactory;

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
            await occ.initMyOcc();
            this._shapeFactory = new occ.ShapeFactory();
        });
        return this;
    }

    useThree(): this {
        this._inits.push(async () => {
            Logger.info("initializing three");

            let three = await import("chili-three");
            this._visualFactory = new three.ThreeVisulFactory();
        });
        return this;
    }

    useUI(): this {
        this._useUI = true;
        return this;
    }

    async build(): Promise<void> {
        for (const init of this._inits) {
            await init();
        }
        this.ensureNecessary();

        let app = Application.build(
            this._visualFactory!,
            this._shapeFactory!,
            this.getServices(),
            this._storage!,
        );
        await this.loadUI(app);

        Logger.info("Application build completed");
    }

    private ensureNecessary() {
        if (this._shapeFactory === undefined) {
            throw new Error("ShapeFactory not set");
        }
        if (this._visualFactory === undefined) {
            throw new Error("VisualFactory not set");
        }
        if (this._storage === undefined) {
            throw new Error("storage has not been initialized");
        }
    }

    private async loadUI(app: Application) {
        if (this._useUI) {
            let ui = await import("chili-ui");
            ui.MainWindow.instance.init(app);
        }
    }

    protected getServices(): IService[] {
        return [
            new CommandService(),
            new HotkeyService(),
            new EditorService((document: IDocument, selected: INode[]) => {
                return new EditEventHandler(document, selected);
            }),
        ];
    }
}
