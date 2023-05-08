// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IView, IViewFactory, IVisual, Plane } from "chili-core";
import { Scene } from "three";
import { ThreeView } from "./threeView";
import { ThreeVisul } from "./threeVisual";

export class ThreeViewFactory implements IViewFactory {
    constructor(readonly visualization: IVisual, readonly scene: Scene) {}

    create(name: string, workplane: Plane, container: HTMLElement): IView {
        return new ThreeView(this.visualization as ThreeVisul, name, workplane, container, this.scene);
    }
}
