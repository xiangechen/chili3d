// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IVisualObject } from "chili-core/src/visual/visualObject";
import { Mesh, MeshBasicMaterial } from "three";
import { ThreeHelper } from "./threeHelper";

export class ThreeMeshObject extends Mesh implements IVisualObject {
    get color() {
        return ThreeHelper.toColor((this.material as MeshBasicMaterial).color); // TODO: assert
    }

    get opacity() {
        return (this.material as MeshBasicMaterial).opacity; // TODO: assert
    }

    dispose(): void {
        this.geometry.dispose();
        if (Array.isArray(this.material)) {
            this.material.forEach((m) => m.dispose());
        } else {
            this.material.dispose();
        }
    }
}
