// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication, IDocument, IService, IStorage, Logger, PubSub, Serialized } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { IVisualFactory } from "chili-vis";
import { Document } from "./document";

export class Application implements IApplication {
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

    private _activeDocument: IDocument | undefined;
    get activeDocument(): IDocument | undefined {
        return this._activeDocument;
    }
    set activeDocument(document: IDocument | undefined) {
        if (this._activeDocument === document) return;
        this._activeDocument = document;
        PubSub.default.pub("activeDocumentChanged", document);
    }

    private constructor(
        readonly visualFactory: IVisualFactory,
        readonly shapeFactory: IShapeFactory,
        readonly services: IService[],
        readonly storage: IStorage,
    ) {
        services.forEach((x) => x.register(this));
        services.forEach((x) => x.start());
    }

    async openDocument(id: string): Promise<IDocument | undefined> {
        let document = await Document.open(this, id);
        if (document === undefined) return;
        return await this._changeDocument(document);
    }

    async newDocument(name: string): Promise<IDocument> {
        let document = new Document(this, name);
        return await this._changeDocument(document);
    }

    async loadDocument(data: Serialized): Promise<IDocument> {
        let document = Document.load(this, data);
        return await this._changeDocument(document);
    }

    private async _changeDocument(newDocument: IDocument) {
        if (this.activeDocument) {
            await this.activeDocument.close();
        }
        this.activeDocument = newDocument;
        return newDocument;
    }
}
