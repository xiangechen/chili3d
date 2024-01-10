// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Plane } from "chili-core";
import { Viewer } from "chili-vis";
import { ThreeView } from "./threeView";
import { ThreeVisual } from "./threeVisual";

export class ThreeViwer extends Viewer {
    constructor(readonly threeVisual: ThreeVisual) {
        super(threeVisual);
    }

    protected handleCreateView(name: string, workplane: Plane) {
        return new ThreeView(this.visual.viewer, name, workplane, this.threeVisual.context);
    }
}
