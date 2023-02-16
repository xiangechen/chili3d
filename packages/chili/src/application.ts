// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IResolve, PubSub, Token } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { IVisualizationFactory } from "chili-vis";
import { IApplicationService } from "./services";

export class Application {
    private static _instance: Application | undefined;

    static get instance() {
        if (Application._instance === undefined) {
            throw "Application is not initialized";
        }
        return Application._instance;
    }

    static build(resolve: IResolve, services: IApplicationService[]): Application {
        this._instance = new Application(resolve, services);
        return this._instance;
    }

    readonly visualizationFactory: IVisualizationFactory;
    readonly shapeFactory: IShapeFactory;

    private constructor(readonly resolve: IResolve, readonly services: IApplicationService[]) {
        this.visualizationFactory = this.resolveOrThrow<IVisualizationFactory>(Token.VisulizationFactory);
        this.shapeFactory = this.resolveOrThrow<IShapeFactory>(Token.ShapeFactory);
        services.forEach((x) => x.register(this));
        services.forEach((x) => x.start());
    }

    private resolveOrThrow<T>(token: Token): T {
        let v = this.resolve.resolve<T>(token);
        if (v === undefined) throw `can not resolve ${token}`;
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
