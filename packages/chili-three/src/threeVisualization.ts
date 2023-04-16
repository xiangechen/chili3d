// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    IEventHandler,
    ISelection,
    IViewFactory,
    IVisualization,
    IVisualizationContext,
} from "chili-core";
import { AxesHelper, DirectionalLight, Scene } from "three";

import { ThreeSelection } from "./threeSelection";
import { ThreeSelectHandler } from "./threeSelectionEventHandler";
import { ThreeViewFactory } from "./threeViewFactory";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeVisulizationContext } from "./threeVisulizationContext";

export class ThreeVisulization implements IVisualization {
    private readonly defaultEventHandler: IEventHandler = new ThreeSelectHandler();
    private _renderContext: ThreeVisulizationContext;
    private _scene: Scene;
    private _selection: ThreeSelection;
    private _eventHandler: IEventHandler;
    private _viewFactory: IViewFactory;
    readonly viewHandler: IEventHandler;

    constructor(readonly document: IDocument) {
        this._scene = new Scene();
        this._eventHandler = this.defaultEventHandler;
        this._renderContext = new ThreeVisulizationContext(this._scene);
        this._viewFactory = new ThreeViewFactory(document, this._scene);
        this._selection = new ThreeSelection(document, this._renderContext);
        this.viewHandler = new ThreeViewHandler();
        this.init();
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

    get selection(): ISelection {
        return this._selection;
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
