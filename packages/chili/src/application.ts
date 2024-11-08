// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IApplication,
    ICommand,
    IDataExchange,
    IDocument,
    IService,
    IShapeFactory,
    IStorage,
    IView,
    IVisualFactory,
    IWindow,
    ObservableCollection,
    Plane,
    PubSub,
    Serialized,
} from "chili-core";
import { Document } from "./document";

let app: Application | undefined;

export interface ApplicationOptions {
    visualFactory: IVisualFactory;
    shapeFactory: IShapeFactory;
    services: IService[];
    storage: IStorage;
    dataExchange: IDataExchange;
    mainWindow?: IWindow;
}

export class Application implements IApplication {
    readonly dataExchange: IDataExchange;
    readonly visualFactory: IVisualFactory;
    readonly shapeFactory: IShapeFactory;
    readonly services: IService[];
    readonly storage: IStorage;
    readonly mainWindow?: IWindow;

    readonly views = new ObservableCollection<IView>();
    readonly documents: Set<IDocument> = new Set<IDocument>();

    executingCommand: ICommand | undefined;

    private _activeView: IView | undefined;
    get activeView(): IView | undefined {
        return this._activeView;
    }
    set activeView(value: IView | undefined) {
        if (this._activeView === value) return;
        this._activeView = value;
        PubSub.default.pub("activeViewChanged", value);
    }

    constructor(option: ApplicationOptions) {
        if (app !== undefined) {
            throw new Error("Only one application can be created");
        }
        app = this;
        this.visualFactory = option.visualFactory;
        this.shapeFactory = option.shapeFactory;
        this.services = option.services;
        this.storage = option.storage;
        this.dataExchange = option.dataExchange;
        this.mainWindow = option.mainWindow;

        this.services.forEach((x) => x.register(this));
        this.services.forEach((x) => x.start());

        window.onbeforeunload = this.handleWindowUnload;
    }

    private readonly handleWindowUnload = (event: BeforeUnloadEvent) => {
        if (this.activeView) {
            // Cancel the event as stated by the standard.
            event.preventDefault();
            // Chrome requires returnValue to be set.
            event.returnValue = "";
        }
    };

    async openDocument(id: string): Promise<IDocument | undefined> {
        let document = await Document.open(this, id);
        await this.createActiveView(document);
        return document;
    }

    async newDocument(name: string): Promise<IDocument> {
        let document = new Document(this, name);
        await this.createActiveView(document);
        return document;
    }

    async loadDocument(data: Serialized): Promise<IDocument | undefined> {
        let document = Document.load(this, data);
        await this.createActiveView(document);
        return document;
    }

    protected async createActiveView(document: IDocument | undefined) {
        if (document === undefined) return undefined;
        let view = document.visual.createView("3d", Plane.XY);
        this.activeView = view;
    }
}
