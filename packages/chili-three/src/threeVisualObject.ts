// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IVisualObject, Matrix4, XYZ } from "chili-core";
import { Box3, Group, Object3D } from "three";
import { ThreeHelper } from "./threeHelper";

export class ThreeVisualObject extends Group implements IVisualObject {
    get transform() {
        return ThreeHelper.toMatrix(this.matrix);
    }

    set transform(value: Matrix4) {
        this.matrix.fromArray(value.toArray());
    }

    constructor(readonly proxy: Object3D) {
        super();
        this.add(proxy);
        this.matrixAutoUpdate = false;
    }

    boundingBox(): { min: XYZ; max: XYZ } {
        const box = new Box3();
        box.setFromObject(this.proxy);
        return { min: ThreeHelper.toXYZ(box.min), max: ThreeHelper.toXYZ(box.max) };
    }

    dispose(): void {
        const disposeObject3D = (disposable: any) => {
            disposable.geometry?.dispose();
            disposable.material?.dispose();
        };
        this.proxy.traverse((child) => {
            disposeObject3D(child);
        });
        disposeObject3D(this.proxy);
    }
}
