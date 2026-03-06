// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Application, CommandService, EditEventHandler, EditorService, HotkeyService } from "@chili3d/app";
import {
    Config,
    Constants,
    I18n,
    type IApplication,
    type IDataExchange,
    type IDocument,
    type INode,
    type IService,
    type IShapeFactory,
    type IStorage,
    type IVisualFactory,
    type IWindow,
    type Locale,
    Logger,
} from "@chili3d/core";
import type { IAdditionalModule } from "./additionalModule";
import { DefaultDataExchange } from "./defaultDataExchange";

export class AppBuilder {
    protected readonly _inits: (() => Promise<void>)[] = [];
    protected readonly _additionalModules: IAdditionalModule[] = [];
    protected _storage?: IStorage;
    protected _visualFactory?: IVisualFactory;
    protected _shapeFactory?: IShapeFactory;
    protected _window?: IWindow;

    constructor() {
        this.initI18n();
        this.initConfig();
        this.ensureAPI();
    }

    protected ensureAPI() {
        this._inits.push(async () => {
            Logger.info("initializing api");

            (globalThis as any).ChiliCore = await import("@chili3d/core");
            (globalThis as any).ChiliElement = await import("@chili3d/element");
        });
    }

    protected initConfig() {
        Config.instance.init("config");
        return this;
    }

    protected initI18n() {
        this._inits.push(async () => {
            Logger.info("initializing i18n");

            const i18n = await import("@chili3d/i18n");
            for (const key of Object.keys(i18n)) {
                I18n.addLanguage((i18n as { [key: string]: Locale })[key]);
            }
        });
    }

    useIndexedDB() {
        this._inits.push(async () => {
            Logger.info("initializing IndexedDBStorage");

            const db = await import("@chili3d/storage");
            this._storage = new db.IndexedDBStorage();
            await this._storage.createDBIfNeeded(Constants.DBName, [
                Constants.DocumentTable,
                Constants.RecentTable,
            ]);
        });
        return this;
    }

    useWasmOcc() {
        this._inits.push(async () => {
            Logger.info("initializing wasm occ");

            const wasm = await import("@chili3d/wasm");
            await wasm.initWasm();
            this._shapeFactory = new wasm.ShapeFactory();
        });
        return this;
    }

    useThree(): this {
        this._inits.push(async () => {
            Logger.info("initializing three");

            const three = await import("@chili3d/three");
            this._visualFactory = new three.ThreeVisulFactory();
        });
        return this;
    }

    useUI(): this {
        this._inits.push(async () => {
            Logger.info("initializing MainWindow");

            this.loadAdditionalI18n();

            const ui = await import("@chili3d/ui");
            const app = document.getElementById("app") as HTMLElement;
            this._window = new ui.MainWindow(await this.getRibbonTabs(), "iconfont.js", app);
        });
        return this;
    }

    addAdditionalModules(...modules: IAdditionalModule[]): this {
        this._additionalModules.push(...modules);
        return this;
    }

    async getRibbonTabs() {
        const defaultRibbon = await import("./ribbon");
        return defaultRibbon.DefaultRibbon;
    }

    async build(): Promise<IApplication> {
        for (const init of this._inits) {
            await init();
        }
        this.ensureNecessary();

        const app = this.createApp();
        await this._window?.init(app);
        await this.loadDefaultPlugins(app);
        this.loadAdditionalCommands();

        Logger.info("Application build completed");

        return app;
    }

    protected async loadDefaultPlugins(app: IApplication) {
        const folderUrl = window.location.origin + "/plugins/";
        try {
            const response = await fetch(folderUrl + "plugins.json");
            if (!response.ok) {
                return;
            }
            const config = await response.json();
            const plugins = config.plugins as string[];
            for (const plugin of plugins ?? []) {
                await app.pluginManager.loadFromUrl(folderUrl + plugin);
            }
        } catch {
            Logger.warn(`Failed to load plugins from folder: ${folderUrl}`);
        }
    }

    createApp() {
        return new Application({
            storage: this._storage!,
            shapeFactory: this._shapeFactory!,
            visualFactory: this._visualFactory!,
            services: this.getServices(),
            mainWindow: this._window,
            dataExchange: this.initDataExchange(),
        });
    }

    initDataExchange(): IDataExchange {
        return new DefaultDataExchange();
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

    private loadAdditionalI18n() {
        for (const module of this._additionalModules) {
            module.i18n().forEach((local) => {
                I18n.combineTranslation(local.language, local.translation);
            });
        }
    }

    private loadAdditionalCommands() {
        for (const module of this._additionalModules) {
            if (this._window) {
                module.ribbonCommands().forEach((command) => {
                    this._window!.ribbon.addRibbonCommand(
                        command.tabName,
                        command.groupName,
                        command.command,
                    );
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
