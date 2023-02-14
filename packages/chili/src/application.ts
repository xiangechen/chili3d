// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IResolve, PubSub, Token } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { IVisualizationFactory } from "chili-vis";

export class Application {
    private static _instance: Application | undefined;

    static get instance() {
        if (Application._instance === undefined) {
            throw "Application is not initialized";
        }
        return Application._instance;
    }

    static init(resolve: IResolve) {
        this._instance = new Application(resolve);
    }

    readonly visualizationFactory: IVisualizationFactory;
    readonly shapeFactory: IShapeFactory;

    private constructor(readonly resolve: IResolve) {
        this.visualizationFactory = resolve.resolve<IVisualizationFactory>(Token.VisulizationFactory)!;
        this.shapeFactory = resolve.resolve<IShapeFactory>(Token.ShapeFactory)!;
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
