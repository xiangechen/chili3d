// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ThreeVisulizationContext } from "./threeVisulizationContext";
import ThreeView from "./threeView";
import { AxesHelper, DirectionalLight, Mesh, Scene } from "three";
import { ThreeSelection } from "./threeSelection";
import { IEventHandler, IVisualization, IVisualizationContext, ISelection, IView } from "chili-vis";
import { IDocument, IViewer } from "chili-core";
import { ThreeSelectHandler } from "./threeSelectionHandle";
import { Plane } from "chili-shared";
import { ThreeViewHandler } from "./threeViewHandle";

export class ThreeVisulization implements IVisualization {
    private _renderContext: ThreeVisulizationContext;
    private _scene: Scene;
    private _selection: ThreeSelection;
    private _eventHandler: IEventHandler;
    readonly viewHandler: IEventHandler;

    constructor(readonly document: IDocument) {
        this._scene = new Scene();
        this._eventHandler = new ThreeSelectHandler();
        this._renderContext = new ThreeVisulizationContext(this._scene);
        this._selection = new ThreeSelection(document, this._renderContext);
        this.viewHandler = new ThreeViewHandler();
        this.init();
    }

    get eventHandler(): IEventHandler {
        return this._eventHandler;
    }

    set eventHandler(value: IEventHandler) {
        this._eventHandler = value;
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

    createView(name: string, container: HTMLElement, workplane: Plane): IView {
        return new ThreeView(this.document, name, workplane, container, this._scene);
    }
}
