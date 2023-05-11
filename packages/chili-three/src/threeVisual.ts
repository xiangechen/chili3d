// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    IEventHandler,
    ISelection,
    IView,
    IViewer,
    IVisual,
    IVisualContext,
    Plane,
    ShapeType,
} from "chili-core";
import { AxesHelper, DirectionalLight, Scene } from "three";

import { SelectionHandler } from "chili-vis";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeViwer } from "./threeViewer";

export class ThreeVisual implements IVisual {
    private readonly defaultEventHandler: IEventHandler = new SelectionHandler();
    private _renderContext: ThreeVisualContext;
    private _scene: Scene;
    private _eventHandler: IEventHandler;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;
    selectionType: ShapeType = ShapeType.Shape;

    constructor(readonly document: IDocument, readonly selection: ISelection) {
        this._scene = new Scene();
        this._eventHandler = this.defaultEventHandler;
        this.viewer = new ThreeViwer(this, this._scene);
        this._renderContext = new ThreeVisualContext(this._scene);
        this.viewHandler = new ThreeViewHandler();
        this.init();
    }

    get scene(): Scene {
        return this._scene;
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
