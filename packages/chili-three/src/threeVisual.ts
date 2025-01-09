// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable, IDocument, IEventHandler, IVisual, Logger, Plane } from "chili-core";
import { NodeSelectionHandler } from "chili-vis";
import { AmbientLight, AxesHelper, Object3D, Scene } from "three";
import { ThreeHighlighter } from "./threeHighlighter";
import { ThreeView } from "./threeView";
import { ThreeVisualContext } from "./threeVisualContext";

Object3D.DEFAULT_UP.set(0, 0, 1);

export class ThreeVisual implements IVisual {
    readonly defaultEventHandler: IEventHandler;
    readonly context: ThreeVisualContext;
    readonly scene: Scene;
    readonly highlighter: ThreeHighlighter;

    private _eventHandler: IEventHandler;

    get eventHandler() {
        return this._eventHandler;
    }

    set eventHandler(value: IEventHandler) {
        if (this._eventHandler === value) return;
        this._eventHandler = value;
        Logger.info(`Changed EventHandler to ${Object.getPrototypeOf(value).constructor.name}`);
    }

    constructor(readonly document: IDocument) {
        this.scene = this.initScene();
        this.defaultEventHandler = new NodeSelectionHandler(document, true);
        this.context = new ThreeVisualContext(this, this.scene);
        this.highlighter = new ThreeHighlighter(this.context);
        this._eventHandler = this.defaultEventHandler;
    }

    initScene() {
        let scene = new Scene();
        let envLight = new AmbientLight(0x888888, 4);
        let axisHelper = new AxesHelper(250);
        scene.add(envLight, axisHelper);
        return scene;
    }

    resetEventHandler() {
        this.eventHandler = this.defaultEventHandler;
    }

    isExcutingHandler(): boolean {
        return this.eventHandler !== this.defaultEventHandler;
    }

    createView(name: string, workplane: Plane) {
        return new ThreeView(this.document, name, workplane, this.highlighter, this.context);
    }

    update(): void {
        this.document.application.views.forEach((view) => {
            if (view.document === this.document) view.update();
        });
    }

    dispose() {
        this.context.dispose();
        this.defaultEventHandler.dispose();
        this._eventHandler.dispose();
        this.scene.traverse((x) => {
            if (IDisposable.isDisposable(x)) x.dispose();
        });
        this.scene.clear();
    }
}
