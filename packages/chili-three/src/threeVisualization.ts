// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    IEventHandler,
    ISelection,
    IViewFactory,
    IViewer,
    IVisualization,
    IVisualizationContext,
} from "chili-core";
import { AxesHelper, DirectionalLight, Scene } from "three";

import { SelectionHandler } from "./selectionEventHandler";
import { ThreeViewFactory } from "./threeViewFactory";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeVisulizationContext } from "./threeVisulizationContext";
import { Viewer } from "./viewer";
import { Selection } from "./selection";

export class ThreeVisulization implements IVisualization {
    private readonly defaultEventHandler: IEventHandler = new SelectionHandler();
    private _renderContext: ThreeVisulizationContext;
    private _scene: Scene;
    private _eventHandler: IEventHandler;
    private _viewFactory: IViewFactory;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;
    readonly selection: ISelection;

    constructor(readonly document: IDocument) {
        this._scene = new Scene();
        this._eventHandler = this.defaultEventHandler;
        this.viewer = new Viewer(this);
        this._renderContext = new ThreeVisulizationContext(this._scene);
        this._viewFactory = new ThreeViewFactory(this, this._scene);
        this.viewHandler = new ThreeViewHandler();
        this.selection = new Selection(this);
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

    get context(): IVisualizationContext {
        return this._renderContext;
    }
}
