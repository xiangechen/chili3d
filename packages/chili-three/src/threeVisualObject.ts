// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    ComponentNode,
    GroupNode,
    IShape,
    ISubShape,
    IVisualObject,
    Matrix4,
    MeshNode,
    Mesh as OccMesh,
    ShapeMeshRange,
    ShapeType,
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
import { IHighlightable } from "./highlightable";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { ThreeVisualContext } from "./threeVisualContext";

const HighlightFaceMaterial = new MeshLambertMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightFaceColor),
    side: DoubleSide,
    transparent: true,
    opacity: 0.56,
});

export abstract class ThreeVisualObject extends Object3D implements IVisualObject {
    get transform() {
        return ThreeHelper.toMatrix(this.matrix);
    }
    set transform(value: Matrix4) {
        this.matrix.fromArray(value.toArray());
    }

    private _node: VisualNode;
    get node(): VisualNode {
        return this._node;
    }

    worldTransform(): Matrix4 {
        return ThreeHelper.toMatrix(this.matrixWorld);
    }

    constructor(node: VisualNode) {
        super();
        this._node = node;
        this.matrixAutoUpdate = false;
        this.transform = node.transform;
        node.onPropertyChanged(this.handlePropertyChanged);
    }

    private readonly handlePropertyChanged = (property: keyof VisualNode) => {
        if (property === "transform") {
            this.transform = this.node.transform;
        }
    };

    boundingBox(): BoundingBox | undefined {
        return ThreeHelper.getBoundingBox(this);
    }

    dispose() {
        this.node.removePropertyChanged(this.handlePropertyChanged);
        this._node = null as any;
    }

    abstract getSubShapeAndIndex(
        shapeType: "face" | "edge",
        subVisualIndex: number,
    ): {
        shape: IShape | undefined;
        subShape: ISubShape | undefined;
        index: number;
        groups: ShapeMeshRange[];
    };

    abstract subShapeVisual(shapeType: ShapeType): (Mesh | LineSegments2)[];

    abstract wholeVisual(): (Mesh | LineSegments2)[];
}

export class ThreeMeshObject extends ThreeVisualObject implements IHighlightable {
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

    highlight() {
        if (this._mesh instanceof Mesh) {
            this._mesh.material = HighlightFaceMaterial;
        }

        if (this._mesh instanceof LineSegments2) {
            this._mesh.material = hilightEdgeMaterial;
        }
    }

    unhighlight() {
        if (this._mesh instanceof Mesh) {
            this._mesh.material = this.material;
        }

        if (this._mesh instanceof LineSegments2) {
            this._mesh.material = this.material as LineMaterial;
        }
    }

    getSubShapeAndIndex(
        shapeType: "face" | "edge",
        subVisualIndex: number,
    ): {
        shape: IShape | undefined;
        subShape: ISubShape | undefined;
        index: number;
        groups: ShapeMeshRange[];
    } {
        return {
            shape: undefined,
            subShape: undefined,
            index: -1,
            groups: [],
        };
    }

    override subShapeVisual(shapeType: ShapeType): (Mesh | LineSegments2)[] {
        return [];
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
            this.material = this.context.getMaterial(this.meshNode.materialId);
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
        if (this.meshNode.mesh.groups.length > 1) buff.groups = this.meshNode.mesh.groups;
        buff.computeBoundingBox();
        return new Mesh(buff, this.context.getMaterial(this.meshNode.materialId));
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

    override wholeVisual() {
        return [this.mesh];
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

    worldTransform(): Matrix4 {
        return ThreeHelper.toMatrix(this.matrixWorld);
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

    boundingBox(): BoundingBox | undefined {
        return ThreeHelper.getBoundingBox(this);
    }

    dispose() {
        this.groupNode.removePropertyChanged(this.handlePropertyChanged);
    }
}

export class ThreeComponentObject extends ThreeVisualObject implements IHighlightable {
    private _boundbox?: LineSegments2;
    private _edges?: LineSegments2;
    private _faces?: Mesh;
    private _lines?: LineSegments2;
    private _meshes?: Mesh;

    get edges() {
        return this._edges;
    }

    get faces() {
        return this._faces;
    }

    get lines() {
        return this._lines;
    }

    get meshes() {
        return this._meshes;
    }

    private _edgeMaterial = new LineMaterial({
        linewidth: 1,
        color: VisualConfig.defaultEdgeColor,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });

    constructor(
        readonly componentNode: ComponentNode,
        readonly context: ThreeVisualContext,
    ) {
        super(componentNode);
        this.initEdges();
        this.initFaces();
    }

    private initEdges() {
        const data = this.componentNode.component.mesh.edge;
        if (!data) {
            return;
        }

        const buff = ThreeGeometryFactory.createEdgeBufferGeometry(data);
        this._edges = new LineSegments2(buff, this._edgeMaterial);
        this.add(this._edges);
    }

    private initFaces() {
        const data = this.componentNode.component.mesh.face;
        if (!data) {
            return;
        }

        const buff = ThreeGeometryFactory.createFaceBufferGeometry(data);
        if (data.groups.length > 1) buff.groups = data.groups;
        const materials = this.context.getMaterial(this.componentNode.component.mesh.faceMaterials);
        this._faces = new Mesh(buff, materials);
        this.add(this._faces);
    }

    private initMesh(mesh: OccMesh) {}

    override boundingBox(): BoundingBox | undefined {
        return this.componentNode.component.boundingBox;
    }

    highlight(): void {
        if (!this._boundbox) {
            const box = this.componentNode.component.boundingBox;
            if (!box) {
                return;
            }

            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(BoundingBox.wireframe(box).position);
            this._boundbox = new LineSegments2(geometry, hilightEdgeMaterial);
            this.add(this._boundbox);
        }

        this._boundbox.visible = true;
    }

    unhighlight(): void {
        if (this._boundbox) {
            this._boundbox.visible = false;
        }
    }

    override getSubShapeAndIndex(shapeType: "face" | "edge", subVisualIndex: number) {
        const range =
            shapeType === "face"
                ? this.componentNode.component.mesh.face.range
                : this.componentNode.component.mesh.edge.range;
        const index = ThreeHelper.findGroupIndex(range, subVisualIndex);
        if (index !== undefined) {
            return {
                shape: range[index].shape,
                subShape: range[index].shape,
                index,
                groups: range,
            };
        }

        return {
            shape: undefined,
            subShape: undefined,
            index: -1,
            groups: [],
        };
    }

    override subShapeVisual(shapeType: ShapeType): (Mesh | LineSegments2)[] {
        const shapes: (Mesh | LineSegments2 | undefined)[] = [];

        const isWhole =
            shapeType === ShapeType.Shape ||
            ShapeType.hasCompound(shapeType) ||
            ShapeType.hasCompoundSolid(shapeType) ||
            ShapeType.hasSolid(shapeType);

        if (isWhole || ShapeType.hasEdge(shapeType) || ShapeType.hasWire(shapeType)) {
            shapes.push(this.edges);
        }

        if (isWhole || ShapeType.hasFace(shapeType) || ShapeType.hasShell(shapeType)) {
            shapes.push(this.faces);
        }

        return shapes.filter((x) => x !== undefined);
    }

    override wholeVisual(): (Mesh | LineSegments2)[] {
        return [this.edges, this.faces, this.lines, this.meshes].filter((x) => x !== undefined);
    }
}
