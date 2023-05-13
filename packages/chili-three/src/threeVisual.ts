// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IEventHandler, IViewer, IVisual, IVisualContext, ShapeType } from "chili-core";
import { Scene } from "three";
import { SelectionHandler } from "chili-vis";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeViwer } from "./threeViewer";

export class ThreeVisual implements IVisual {
    private readonly defaultEventHandler: IEventHandler = new SelectionHandler();
    readonly context: ThreeVisualContext;
    private _scene: Scene;
    private _eventHandler: IEventHandler;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;

    constructor(readonly document: IDocument) {
        this._scene = new Scene();
        this._eventHandler = this.defaultEventHandler;
        this.viewer = new ThreeViwer(this, this._scene);
        this.context = new ThreeVisualContext(this._scene);
        this.viewHandler = new ThreeViewHandler();
    }

    get eventHandler(): IEventHandler {
        return this._eventHandler;
    }

    set eventHandler(value: IEventHandler) {
        this._eventHandler = value;
    }

    resetEventHandler() {
        this._eventHandler = this.defaultEventHandler;
    }
}
