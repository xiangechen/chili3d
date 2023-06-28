// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, IDisposable, IDocument, IEventHandler, IViewer, IVisual, Logger } from "chili-core";
import { ModelSelectionHandler } from "chili-vis";
import { AxesHelper, DirectionalLight, Object3D, Scene } from "three";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeViwer } from "./threeViewer";
import { ThreeVisualContext } from "./threeVisualContext";

Object3D.DEFAULT_UP.set(0, 0, 1);

export class ThreeVisual implements IVisual {
    readonly defaultEventHandler: IEventHandler;
    readonly context: ThreeVisualContext;
    readonly scene: Scene;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;

    #eventHandler: IEventHandler;

    get eventHandler() {
        return this.#eventHandler;
    }

    set eventHandler(value: IEventHandler) {
        if (this.#eventHandler === value) return;
        this.#eventHandler = value;
        Logger.info(`Changed EventHandler to ${Object.getPrototypeOf(value).constructor.name}`);
    }

    constructor(readonly document: IDocument) {
        this.scene = this.initScene();
        this.defaultEventHandler = new ModelSelectionHandler(document, true);
        this.viewer = new ThreeViwer(this, this.scene);
        this.context = new ThreeVisualContext(this.scene);
        this.viewHandler = new ThreeViewHandler();
        this.#eventHandler = this.defaultEventHandler;
    }

    initScene() {
        let scene = new Scene();
        const light = new DirectionalLight(0xffffff, 0.5);
        let axisHelper = new AxesHelper(250);
        scene.add(light, axisHelper);
        return scene;
    }

    resetEventHandler() {
        this.eventHandler = this.defaultEventHandler;
    }

    async dispose() {
        this.context.dispose();
        this.viewer.dispose();
        this.defaultEventHandler.dispose();
        this.viewHandler.dispose();
        this.#eventHandler.dispose();
        this.scene.traverse((x) => {
            if (IDisposable.isDisposable(x)) x.dispose();
        });
        this.scene.clear();
    }
}
