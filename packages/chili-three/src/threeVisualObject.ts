// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    GroupNode,
    IVisualObject,
    Matrix4,
    MeshNode,
    VisualConfig,
    VisualNode,
} from "chili-core";
import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    Material,
    Mesh,
    MeshLambertMaterial,
    Object3D,
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

    constructor(private visualNode: VisualNode) {
        super();
        this.matrixAutoUpdate = false;
        this.transform = visualNode.transform;
        visualNode.onPropertyChanged(this.handlePropertyChanged);
    }

    private readonly handlePropertyChanged = (property: keyof VisualNode) => {
        if (property === "transform") {
            this.transform = this.visualNode.transform;
        }
    };

    boundingBox(): BoundingBox {
        return ThreeHelper.getBoundingBox(this);
    }

    dispose() {
        this.visualNode.removePropertyChanged(this.handlePropertyChanged);
        this.visualNode = null as any;
    }
}

export class ThreeMeshObject extends ThreeVisualObject {
    private _mesh: LineSegments2 | Mesh | Line2;
    private material: Material | Material[];

    get mesh() {
        return this._mesh;
    }

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
        switch (this.meshNode.mesh.meshType) {
            case "line":
                return this.newLine();
            case "linesegments":
                return this.newLineSegments();
            case "surface":
                return this.newMesh();
            default:
                throw new Error("Unknown mesh type");
        }
    }

    private readonly handleGeometryPropertyChanged = (property: keyof MeshNode) => {
        if (property === "mesh") {
            this.disposeMesh();
            this._mesh = this.createMesh();
            this.add(this._mesh);
        } else if (property === "materialId" && this._mesh instanceof Mesh) {
            this.material = this.getMaterial();
            this._mesh.material = this.material;
        }
    };

    private newMesh() {
        const buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(this.meshNode.mesh.position, 3));
        if (this.meshNode.mesh.normal)
            buff.setAttribute("normal", new Float32BufferAttribute(this.meshNode.mesh.normal, 3));
        if (this.meshNode.mesh.uv)
            buff.setAttribute("uv", new Float32BufferAttribute(this.meshNode.mesh.uv, 2));
        if (this.meshNode.mesh.index) buff.setIndex(this.meshNode.mesh.index);
        this.meshNode.mesh.groups.forEach((g) => {
            const index = Array.isArray(this.meshNode.materialId)
                ? this.meshNode.materialId.indexOf(g.materialId)
                : 0;
            buff.addGroup(g.start, g.count, index);
        });
        buff.computeBoundingBox();
        return new Mesh(buff, this.getMaterial());
    }

    private getMaterial() {
        if (Array.isArray(this.meshNode.materialId)) {
            return this.meshNode.materialId.map((id) => this.context.getMaterial(id));
        } else if (typeof this.meshNode.materialId === "string") {
            return this.context.getMaterial(this.meshNode.materialId);
        }
        return this.context.materialMap.values().next().value!;
    }

    private newLineSegments() {
        const material = new LineMaterial({
            linewidth: 1,
            color: this.meshNode.mesh.color as number,
            side: DoubleSide,
        });
        const buff = new LineSegmentsGeometry();
        buff.setPositions(this.meshNode.mesh.position);
        buff.computeBoundingBox();
        return new LineSegments2(buff, material);
    }

    private newLine() {
        const material = new LineMaterial({
            linewidth: 1,
            color: this.meshNode.mesh.color as number,
            side: DoubleSide,
        });
        const geometry = new LineGeometry();
        geometry.setPositions(this.meshNode.mesh.position);
        geometry.computeBoundingBox();
        return new Line2(geometry, material);
    }

    private disposeMesh() {
        if (this._mesh instanceof LineSegments2 || this._mesh instanceof Line2) {
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

export class GroupVisualObject extends Group implements IVisualObject {
    get transform() {
        return ThreeHelper.toMatrix(this.matrix);
    }
    set transform(value: Matrix4) {
        this.matrix.fromArray(value.toArray());
    }

    constructor(private readonly groupNode: GroupNode) {
        super();
        this.matrixAutoUpdate = false;
        this.transform = groupNode.transform;
        groupNode.onPropertyChanged(this.handlePropertyChanged);
    }

    private readonly handlePropertyChanged = (property: keyof GroupNode) => {
        if (property === "transform") {
            this.transform = this.groupNode.transform;
        }
    };

    boundingBox(): BoundingBox {
        return ThreeHelper.getBoundingBox(this);
    }

    dispose() {
        this.groupNode.removePropertyChanged(this.handlePropertyChanged);
    }
}
