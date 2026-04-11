// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDocument,
    type IEventHandler,
    type IMeshExporter,
    type IVisual,
    isDisposable,
    Logger,
    type Plane,
} from "@chili3d/core";
import { NodeSelectionHandler } from "@chili3d/core/src/eventHandlers";
import { AmbientLight, AxesHelper, Object3D, Scene } from "three";
import { ThreeMeshExporter } from "./meshExporter";
import { ThreeHighlighter } from "./threeHighlighter";
import { ThreeView } from "./threeView";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeVisualContext } from "./threeVisualContext";

Object3D.DEFAULT_UP.set(0, 0, 1);

export class ThreeVisual implements IVisual {
    readonly context: ThreeVisualContext;
    readonly scene: Scene;
    readonly highlighter: ThreeHighlighter;
    readonly meshExporter: IMeshExporter;

    viewHandler: IEventHandler;
    eventHandler: IEventHandler;
    defaultEventHandler: IEventHandler;

    constructor(readonly document: IDocument) {
        this.scene = this.initScene();
        this.defaultEventHandler = this.createDefaultSelectionHandler(document);
        this.viewHandler = new ThreeViewHandler();
        this.context = new ThreeVisualContext(this, this.scene);
        this.highlighter = new ThreeHighlighter(this.context);
        this.meshExporter = new ThreeMeshExporter(this.context);
        this.eventHandler = this.defaultEventHandler;
    }

    protected createDefaultSelectionHandler(document: IDocument) {
        return new NodeSelectionHandler(document, true);
    }

    initScene() {
        const scene = new Scene();
        const envLight = new AmbientLight(0x888888, 4);
        const axisHelper = new AxesHelper(250);
        scene.add(envLight, axisHelper);
        return scene;
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
        this.eventHandler.dispose();
        this.viewHandler.dispose();
        this.scene.traverse((x) => {
            if (isDisposable(x)) x.dispose();
        });
        this.scene.clear();
    }
}
