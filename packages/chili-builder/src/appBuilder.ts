// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Application, CommandService, EditEventHandler, EditorService, HotkeyService } from "chili";
import {
    I18n,
    IDocument,
    INode,
    IService,
    IShapeFactory,
    IStorage,
    IVisualFactory,
    IWindow,
    Logger,
} from "chili-core";
import { IAdditionalModule } from "./additionalModule";

export class AppBuilder {
    protected readonly _inits: (() => Promise<void>)[] = [];
    protected readonly _additionalModules: IAdditionalModule[] = [];
    protected _storage?: IStorage;
    protected _visualFactory?: IVisualFactory;
    protected _shapeFactory?: IShapeFactory;
    protected _window?: IWindow;

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
        this._inits.push(async () => {
            Logger.info("initializing MainWindow");

            let ui = await import("chili-ui");
            this._window = new ui.MainWindow();
        });
        return this;
    }

    addAdditionalModules(...modules: IAdditionalModule[]): this {
        this._additionalModules.push(...modules);
        return this;
    }

    async build(): Promise<void> {
        for (const init of this._inits) {
            await init();
        }
        this.ensureNecessary();

        Application.build(
            this._visualFactory!,
            this._shapeFactory!,
            this.getServices(),
            this._storage!,
            this._window,
        );

        this.loadAdditionalModule();

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

    private loadAdditionalModule() {
        for (const module of this._additionalModules) {
            module.i18n().forEach((local) => {
                I18n.combineTranslation(local.code as any, local.translation);
            });
            if (this._window) {
                module.commands().forEach((command) => {
                    this._window!.registerRibbonCommand(command.tabName, command.groupName, command.command);
                });
            }
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
