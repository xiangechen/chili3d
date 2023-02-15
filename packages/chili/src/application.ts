// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IResolve, PubSub, Token } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { IVisualizationFactory } from "chili-vis";
import { IApplicationService } from "./services";
import { CommandService } from "./services/commandService";
import { EditorService } from "./services/editorService";
import { HotkeyMap, HotkeyService } from "./services/hotkeyService";

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
        this.visualizationFactory = resolve.resolve<IVisualizationFactory>(Token.VisulizationFactory)!;
        this.shapeFactory = resolve.resolve<IShapeFactory>(Token.ShapeFactory)!;
        services.map((x) => x.register(this));
        services.map((x) => x.start());
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
