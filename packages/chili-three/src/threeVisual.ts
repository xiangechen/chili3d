// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IEventHandler, IViewer, IVisual, IVisualContext, ShapeType } from "chili-core";
import { AxesHelper, DirectionalLight, Object3D, Scene } from "three";
import { SelectionHandler } from "chili-vis";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeViwer } from "./threeViewer";

Object3D.DEFAULT_UP.set(0, 0, 1);
const DefaultEventHandler: IEventHandler = new SelectionHandler();

export class ThreeVisual implements IVisual {
    readonly context: ThreeVisualContext;
    readonly scene: Scene;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;

    eventHandler: IEventHandler = DefaultEventHandler;

    constructor(readonly document: IDocument) {
        this.scene = this.initScene();
        this.viewer = new ThreeViwer(this, this.scene);
        this.context = new ThreeVisualContext(this.scene);
        this.viewHandler = new ThreeViewHandler();
    }

    initScene() {
        let scene = new Scene();
        const light = new DirectionalLight(0xffffff, 0.5);
        let axisHelper = new AxesHelper(250);
        scene.add(light, axisHelper);
        return scene;
    }

    resetEventHandler() {
        this.eventHandler = DefaultEventHandler;
    }
}
