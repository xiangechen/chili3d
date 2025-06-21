// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Application, CommandService, EditEventHandler, EditorService, HotkeyService } from "chili";
import {
    I18n,
    IDataExchange,
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
import { DefaultDataExchange } from "./defaultDataExchange";

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

    useWasmOcc() {
        this._inits.push(async () => {
            Logger.info("initializing wasm occ");

            let wasm = await import("chili-wasm");
            await wasm.initWasm();
            this._shapeFactory = new wasm.ShapeFactory();
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

            this.loadAdditionalI18n();

            let ui = await import("chili-ui");
            this._window = new ui.MainWindow(await this.getRibbonTabs());
        });
        return this;
    }

    addAdditionalModules(...modules: IAdditionalModule[]): this {
        this._additionalModules.push(...modules);
        return this;
    }

    async getRibbonTabs() {
        let defaultRibbon = await import("./ribbon");
        return defaultRibbon.DefaultRibbon;
    }

    async build(): Promise<void> {
        for (const init of this._inits) {
            await init();
        }
        this.ensureNecessary();

        let app = this.createApp();
        this._window?.init(app);

        this.loadAdditionalCommands();

        Logger.info("Application build completed");
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
                I18n.combineTranslation(local.code, local.translation);
            });
        }
    }

    private loadAdditionalCommands() {
        for (const module of this._additionalModules) {
            if (this._window) {
                module.ribbonCommands().forEach((command) => {
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
