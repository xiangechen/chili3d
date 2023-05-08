// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    IEventHandler,
    ISelection,
    IViewFactory,
    IViewer,
    IVisual,
    IVisualContext,
} from "chili-core";
import { AxesHelper, DirectionalLight, Scene } from "three";

import { SelectionHandler } from "./selectionEventHandler";
import { ThreeViewFactory } from "./threeViewFactory";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeVisulContext } from "./threeVisulContext";
import { Viewer } from "./viewer";

export class ThreeVisul implements IVisual {
    private readonly defaultEventHandler: IEventHandler = new SelectionHandler();
    private _renderContext: ThreeVisulContext;
    private _scene: Scene;
    private _eventHandler: IEventHandler;
    private _viewFactory: IViewFactory;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;

    constructor(readonly document: IDocument, readonly selection: ISelection) {
        this._scene = new Scene();
        this._eventHandler = this.defaultEventHandler;
        this.viewer = new Viewer(this);
        this._renderContext = new ThreeVisulContext(this._scene);
        this._viewFactory = new ThreeViewFactory(this, this._scene);
        this.viewHandler = new ThreeViewHandler();
        this.init();
    }

    get scene(): Scene {
        return this._scene;
    }

    get viewFactory(): IViewFactory {
        return this._viewFactory;
    }

    get eventHandler(): IEventHandler {
        return this._eventHandler;
    }

    set eventHandler(value: IEventHandler) {
        this._eventHandler = value;
    }

    clearEventHandler() {
        this._eventHandler = this.defaultEventHandler;
    }

    init() {
        const light = new DirectionalLight(0xffffff, 0.5);
        this._scene.add(light);
        let axisHelper = new AxesHelper(250);
        this._scene.add(axisHelper);
    }

    get context(): IVisualContext {
        return this._renderContext;
    }
}
