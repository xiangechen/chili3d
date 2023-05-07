// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IView, IViewFactory, IVisualization, Plane } from "chili-core";
import { Scene } from "three";
import { ThreeView } from "./threeView";
import { ThreeVisulization } from "./threeVisualization";

export class ThreeViewFactory implements IViewFactory {
    constructor(readonly visualization: IVisualization, readonly scene: Scene) {}

    create(name: string, workplane: Plane, container: HTMLElement): IView {
        return new ThreeView(this.visualization as ThreeVisulization, name, workplane, container, this.scene);
    }
}
