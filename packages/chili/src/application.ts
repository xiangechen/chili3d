// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IApplication,
    ICommand,
    IDocument,
    IService,
    IStorage,
    IView,
    IWindow,
    Logger,
    Observable,
    ObservableCollection,
    Plane,
    PubSub,
    Serialized,
} from "chili-core";
import { IShapeFactory } from "chili-geo";
import { IVisualFactory } from "chili-vis";
import { Document } from "./document";

export class Application extends Observable implements IApplication {
    private static _instance: Application | undefined;
    static get instance() {
        if (Application._instance === undefined) {
            throw new Error("Application is not build");
        }
        return Application._instance;
    }

    static build(
        visualFactory: IVisualFactory,
        shapeFactory: IShapeFactory,
        services: IService[],
        storage: IStorage,
        window?: IWindow,
    ): Application {
        if (this._instance) {
            Logger.warn("Application has been built");
        } else {
            this._instance = new Application(visualFactory, shapeFactory, services, storage, window);
            window?.init(this._instance);
        }
        return this._instance;
    }

    private _activeView: IView | undefined;
    get activeView(): IView | undefined {
        return this._activeView;
    }
    set activeView(value: IView | undefined) {
        this.setProperty("activeView", value, () => PubSub.default.pub("activeViewChanged", value));
    }

    readonly views = new ObservableCollection<IView>();
    readonly documents: Set<IDocument> = new Set<IDocument>();

    executingCommand: ICommand | undefined;

    private constructor(
        readonly visualFactory: IVisualFactory,
        readonly shapeFactory: IShapeFactory,
        readonly services: IService[],
        readonly storage: IStorage,
        readonly mainWindow?: IWindow,
    ) {
        super();
        services.forEach((x) => x.register(this));
        services.forEach((x) => x.start());
        window.onbeforeunload = this.handleWindowUnload;
    }

    private handleWindowUnload = (event: BeforeUnloadEvent) => {
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

    private async createActiveView(document: IDocument | undefined) {
        if (document === undefined) return undefined;
        let view = document.visual.createView("3d", Plane.XY);
        this.activeView = view;
    }
}
