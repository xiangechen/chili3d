// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Application, CommandService, HotkeyService, ShowPropertyEventHandler } from "@chili3d/app";
import {
    Config,
    Constants,
    I18n,
    type IApplication,
    type IDataExchange,
    type IService,
    type IShapeProvider,
    type IStorage,
    type IVisualFactory,
    type IWindow,
    type Locale,
    Logger,
} from "@chili3d/core";
import { DefaultDataExchange } from "./defaultDataExchange";
import {
    DefaultRibbon,
    mergeRibbonProfiles,
    ParametricRibbonProfiles,
    type RibbonProfileExtra,
} from "./ribbon";

export class AppBuilder {
    protected readonly _inits: (() => Promise<void>)[] = [];
    protected readonly _ribbonExtras: RibbonProfileExtra[] = [];
    protected _storage?: IStorage;
    protected _visualFactory?: IVisualFactory;
    protected _shapeProvider?: IShapeProvider;
    protected _window?: IWindow;

    constructor() {
        this.initI18n();
        this.initConfig();
        this.ensureAPI();
    }

    protected ensureAPI() {
        this._inits.push(async () => {
            Logger.info("initializing api");

            (globalThis as any).Chili3dCore = await import("@chili3d/core");
            (globalThis as any).Chili3dElement = await import("@chili3d/element");
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
            this._shapeProvider = new wasm.OccShapeProvider();
        });
        return this;
    }

    useParametric(): this {
        this._inits.push(async () => {
            Logger.info("initializing parametric");

            // registers sketch/feature commands, the SketchNode/ParametricBodyNode
            // serializers, and exposes the sketch ribbon contributions
            const parametric = await import("@chili3d/parametric");
            await parametric.initGarlic();
            this._ribbonExtras.push(...parametric.SketchRibbonProfiles, ...ParametricRibbonProfiles);
        });
        return this;
    }

    useThree(): this {
        this._inits.push(async () => {
            Logger.info("initializing three");

            const three = await import("@chili3d/three");
            this._visualFactory = new three.ThreeVisulFactory((d) => new ShowPropertyEventHandler(d));
        });
        return this;
    }

    useUI(): this {
        this._inits.push(async () => {
            Logger.info("initializing MainWindow");

            const ui = await import("@chili3d/ui");
            const app = document.getElementById("app") as HTMLElement;
            this._window = new ui.MainWindow(await this.getRibbonTabs(), "iconfont.js", app);
        });
        return this;
    }

    async getRibbonTabs() {
        return mergeRibbonProfiles(DefaultRibbon, this._ribbonExtras);
    }

    async build(): Promise<IApplication> {
        for (const init of this._inits) {
            await init();
        }
        this.ensureNecessary();

        const app = this.createApp();
        await this._window?.init(app);
        await this.loadDefaultPlugins(app);

        Logger.info("Application build completed");

        return app;
    }

    protected async loadDefaultPlugins(app: IApplication) {
        const urlObj = new URL(window.location.href);
        const pathParts = urlObj.pathname
            .split("/")
            .map((x) => x.trim())
            .filter((x) => x.length > 0);
        if (pathParts.at(-1)?.endsWith(".html")) pathParts.pop();
        urlObj.pathname = `${pathParts.join("/")}/`;
        const folderUrl = `${urlObj.href}plugins/`;
        try {
            const response = await fetch(`${folderUrl}plugins.json`);
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
            shapeProvider: this._shapeProvider!,
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
        if (this._shapeProvider === undefined) {
            throw new Error("ShapeProvider not set");
        }
        if (this._visualFactory === undefined) {
            throw new Error("VisualFactory not set");
        }
        if (this._storage === undefined) {
            throw new Error("storage has not been initialized");
        }
    }

    protected getServices(): IService[] {
        return [new CommandService(), new HotkeyService()];
    }
}
