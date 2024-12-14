// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { BoundingBox, IVisualObject, Matrix4, MeshNode, VisualConfig, VisualNode } from "chili-core";
import {
    Box3,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Material,
    Mesh,
    MeshLambertMaterial,
    Object3D
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";
import { hilightEdgeMaterial } from "./common";
import { ThreeHelper } from "./threeHelper";
import { ThreeVisualContext } from "./threeVisualContext";

const HighlightFaceMaterial = new MeshLambertMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightFaceColor),
    side: DoubleSide,
    transparent: true,
    opacity: 0.56,
});

export class ThreeVisualObject extends Object3D implements IVisualObject {
    get transform() {
        return ThreeHelper.toMatrix(this.matrix);
    }
    set transform(value: Matrix4) {
        this.matrix.fromArray(value.toArray());
    }

    constructor(private readonly visualNode: VisualNode) {
        super();
        this.matrixAutoUpdate = false;
        this.transform = visualNode.transform;
        visualNode.onPropertyChanged(this.handlePropertyChanged);
    }

    private readonly handlePropertyChanged = (property: keyof MeshNode) => {
        if (property === "transform") {
            this.transform = this.visualNode.transform;
        }
    };

    boundingBox(): BoundingBox {
        const box = new Box3();
        box.setFromObject(this);
        return { min: ThreeHelper.toXYZ(box.min), max: ThreeHelper.toXYZ(box.max) };
    }

    dispose() {
        this.visualNode.removePropertyChanged(this.handlePropertyChanged);
    }
}

export class ThreeMeshObject extends ThreeVisualObject {
    private _mesh: LineSegments2 | Mesh | Line2;
    get mesh() {
        return this._mesh;
    }
    private material: Material | Material[];

    constructor(
        readonly context: ThreeVisualContext,
        readonly meshNode: MeshNode,
    ) {
        super(meshNode);
        this._mesh = this.createMesh();
        this.material = this._mesh.material;
        this.add(this._mesh);
        meshNode.onPropertyChanged(this.handleGeometryPropertyChanged);
    }

    setHighlighted(highlighted: boolean) {
        if (this._mesh instanceof Mesh) {
            if (highlighted) {
                this._mesh.material = HighlightFaceMaterial;
            } else {
                this._mesh.material = this.material;
            }
        }

        if (this._mesh instanceof LineSegments2) {
            if (highlighted) {
                this._mesh.material = hilightEdgeMaterial;
            } else {
                this._mesh.material = this.material as LineMaterial;
            }
        }
    }

    private createMesh() {
        if (this.meshNode.mesh.meshType === "line") {
            return this.newLine();
        } else if (this.meshNode.mesh.meshType === "linesegments") {
            return this.newLineSegments();
        } else if (this.meshNode.mesh.meshType === "surface") {
            return this.newMesh();
        }

        throw new Error("Unknown mesh type");
    }

    private readonly handleGeometryPropertyChanged = (property: keyof MeshNode, s: any, o: any) => {
        if (property === "mesh") {
            this.disposeMesh();
            this._mesh = this.createMesh();
            this.add(this._mesh);
        } else if (property === "materialId") {
            if (this._mesh instanceof Mesh) {
                this.material = this.getMaterial();
                this._mesh.material = this.material;
            }
        }
    };

    private newMesh() {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(this.meshNode.mesh.position, 3));
        if (this.meshNode.mesh.normal) {
            buff.setAttribute("normal", new Float32BufferAttribute(this.meshNode.mesh.normal, 3));
        }
        if (this.meshNode.mesh.uv) {
            buff.setAttribute("uv", new Float32BufferAttribute(this.meshNode.mesh.uv, 2));
        }
        if (this.meshNode.mesh.index) {
            buff.setIndex(this.meshNode.mesh.index);
        }
        buff.computeBoundingBox();
        return new Mesh(buff, this.getMaterial());
    }

    private getMaterial() {
        let material: Material | Material[];
        if (Array.isArray(this.meshNode.materialId)) {
            material = this.meshNode.materialId.map(id => this.context.getMaterial(id));
        } else if (typeof this.meshNode.materialId === "string") {
            material = this.context.getMaterial(this.meshNode.materialId);
        } else {
            material = this.context.materialMap.values().next().value!;
        }
        return material;
    }

    private newLineSegments() {
        let material = new LineMaterial({
            linewidth: 1,
            color: this.meshNode.mesh.color as number,
            side: DoubleSide,
        });
        let buff = new LineSegmentsGeometry();
        buff.setPositions(this.meshNode.mesh.position);
        buff.computeBoundingBox();
        return new LineSegments2(buff, material);
    }

    private newLine() {
        let material = new LineMaterial({
            linewidth: 1,
            color: this.meshNode.mesh.color as number,
            side: DoubleSide,
        });
        let geometry = new LineGeometry();
        geometry.setPositions(this.meshNode.mesh.position);
        geometry.computeBoundingBox();
        return new Line2(geometry, material);
    }

    private disposeMesh() {
        if (this._mesh instanceof LineSegments2) {
            this._mesh.material.dispose();
        }
        if (this._mesh instanceof Line2) {
            this._mesh.material.dispose();
        }
        this._mesh.geometry?.dispose();
    }

    override dispose(): void {
        super.dispose();
        this.meshNode.removePropertyChanged(this.handleGeometryPropertyChanged);
        this.disposeMesh();
    }
}
