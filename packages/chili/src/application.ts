// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IApplication,
    ICommand,
    IDocument,
    IService,
    IStorage,
    IView,
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
    ): Application {
        if (this._instance) {
            Logger.warn("Application has been built");
        } else {
            this._instance = new Application(visualFactory, shapeFactory, services, storage);
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
        if (!document) return undefined;
        return await this.handleDocumentAndActiveView(() => document);
    }

    async newDocument(name: string): Promise<IDocument> {
        return await this.handleDocumentAndActiveView(() => new Document(this, name))!;
    }

    async loadDocument(data: Serialized): Promise<IDocument> {
        return await this.handleDocumentAndActiveView(() => Document.load(this, data));
    }

    private async handleDocumentAndActiveView(proxy: () => IDocument) {
        let document = proxy();
        let view = document.visual.createView("3d", Plane.XY);
        this.activeView = view;
        return document;
    }
}
