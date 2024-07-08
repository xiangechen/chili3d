// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IVisualObject, Matrix4, XYZ } from "chili-core";
import { Box3, Mesh, MeshBasicMaterial } from "three";
import { ThreeHelper } from "./threeHelper";

export class ThreeMeshObject extends Mesh implements IVisualObject {
    get transform() {
        return ThreeHelper.toMatrix(this.matrix);
    }

    set transform(value: Matrix4) {
        this.matrix.fromArray(value.toArray());
    }

    get color() {
        return ThreeHelper.toColor((this.material as MeshBasicMaterial).color); // TODO: assert
    }

    get opacity() {
        return (this.material as MeshBasicMaterial).opacity; // TODO: assert
    }

    boundingBox(): { min: XYZ; max: XYZ } {
        const box = new Box3();
        box.setFromObject(this);
        return { min: ThreeHelper.toXYZ(box.min), max: ThreeHelper.toXYZ(box.max) };
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
