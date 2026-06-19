// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type BoundingBox, type IVisualObject, Matrix4, type RefSegmentAnnotation } from "@chili3d/core";
import { DoubleSide, type Mesh, Object3D, type Points } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { Constants } from "./constants";
import type { IHighlightable } from "./highlightable";
import { ThreeHelper } from "./threeHelper";
import type { ThreeVisualContext } from "./threeVisualContext";

const material = new LineMaterial({
    linewidth: 1,
    color: 0xffff00,
    side: DoubleSide,
});

const highlightMaterial = new LineMaterial({
    linewidth: 1,
    color: 0x00ffff,
    side: DoubleSide,
});

export class ThreeRefSegmentAnnotation extends Object3D implements IVisualObject, IHighlightable {
    locked: boolean = false;
    transform: Matrix4 = Matrix4.identity();
    private _mesh: LineSegments2;

    constructor(
        private context: ThreeVisualContext,
        readonly annotation: RefSegmentAnnotation,
    ) {
        super();
        this._mesh = this.newLineSegments();
        this.add(this._mesh);
    }
    highlight(): void {
        this._mesh.material = highlightMaterial;
    }

    unhighlight(): void {
        this._mesh.material = material;
    }

    private newLineSegments() {
        const buff = new LineSegmentsGeometry();
        buff.setPositions([
            this.annotation.startPoint.x,
            this.annotation.startPoint.y,
            this.annotation.startPoint.z,
            this.annotation.endPoint.x,
            this.annotation.endPoint.y,
            this.annotation.endPoint.z,
        ]);
        buff.computeBoundingBox();
        const line = new LineSegments2(buff, material);
        line.layers.set(Constants.Layers.Wireframe);
        return line;
    }

    wholeVisual(): (Mesh | LineSegments2 | Points)[] {
        return [this._mesh];
    }

    boundingBox(): BoundingBox | undefined {
        return ThreeHelper.getBoundingBox(this);
    }

    worldTransform(): Matrix4 {
        return Matrix4.identity();
    }

    dispose(): void {
        this._mesh.geometry?.dispose();
    }
}
