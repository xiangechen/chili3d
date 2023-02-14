// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IView, IViewFactory, Plane } from "chili-core";
import { Scene } from "three";
import ThreeView from "./threeView";

export class ThreeViewFactory implements IViewFactory {
    constructor(readonly scene: Scene) {}

    createView(document: IDocument, name: string, workplane: Plane, container: HTMLElement): IView {
        return new ThreeView(document, name, workplane, container, this.scene);
    }
}
