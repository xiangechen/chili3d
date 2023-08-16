// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IResolve, IService, IStorage, Logger, PubSub, Token } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { IVisualFactory } from "chili-vis";
import { Document } from "chili";

export class Application {
    private static _instance: Application | undefined;

    static get instance() {
        if (Application._instance === undefined) {
            throw new Error("Application is not build");
        }
        return Application._instance;
    }

    static build(resolve: IResolve, services: IService[], storage: IStorage): Application {
        if (this._instance) {
            Logger.warn("Application has been built");
        } else {
            this._instance = new Application(resolve, services, storage);
        }
        return this._instance;
    }

    readonly visualFactory: IVisualFactory;
    readonly shapeFactory: IShapeFactory;

    private constructor(
        readonly resolve: IResolve,
        readonly services: IService[],
        readonly storage: IStorage
    ) {
        this.visualFactory = this.resolveOrThrow<IVisualFactory>(Token.VisulizationFactory);
        this.shapeFactory = this.resolveOrThrow<IShapeFactory>(Token.ShapeFactory);
        services.forEach((x) => x.register(this));
        services.forEach((x) => x.start());

        PubSub.default.sub("openDocument", async (id) => {
            this.activeDocument = await Document.open(id);
        });
    }

    private resolveOrThrow<T>(token: Token): T {
        let v = this.resolve.resolve<T>(token);
        if (v === undefined) throw new Error(`can not resolve ${token.token}`);
        return v;
    }

    private _activeDocument: IDocument | undefined;

    get activeDocument(): IDocument | undefined {
        return this._activeDocument;
    }

    set activeDocument(document: IDocument | undefined) {
        this._activeDocument = document;
        PubSub.default.pub("activeDocumentChanged", document);
    }
}