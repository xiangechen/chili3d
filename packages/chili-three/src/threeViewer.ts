// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IVisual, Plane } from "chili-core";
import { Viewer } from "chili-vis";
import { ThreeView } from "./threeView";
import { Scene } from "three";

export class ThreeViwer extends Viewer {
    constructor(visual: IVisual, private scene: Scene) {
        super(visual);
    }

    protected handleCreateView(name: string, workplane: Plane, dom: HTMLElement) {
        return new ThreeView(this.visual, name, workplane, dom, this.scene);
    }
}
