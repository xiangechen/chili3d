// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDocument,
    type IEventHandler,
    type IMeshExporter,
    type IVisual,
    isDisposable,
    type Plane,
} from "@chili3d/core";
import { AxesHelper, Object3D, Scene } from "three";
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

    constructor(
        readonly document: IDocument,
        defaultEventHandler: IEventHandler,
    ) {
        this.scene = this.initScene();
        this.defaultEventHandler = defaultEventHandler;
        this.viewHandler = new ThreeViewHandler();
        this.context = new ThreeVisualContext(this, this.scene);
        this.highlighter = new ThreeHighlighter(this.context);
        this.meshExporter = new ThreeMeshExporter(this.context);
        this.eventHandler = this.defaultEventHandler;
    }

    // No fill light here: the environment `ThreeVisualContext` builds is what keeps the dark
    // sides off black, and it also gives the metallic materials something to reflect.
    initScene() {
        const scene = new Scene();
        const axisHelper = new AxesHelper(250);
        scene.add(axisHelper);
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
