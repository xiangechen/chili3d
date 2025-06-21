// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    EdgeMeshData,
    FaceMeshData,
    GeometryNode,
    IShape,
    ISubShape,
    IVisualGeometry,
    Matrix4,
    ShapeMeshRange,
    ShapeNode,
    ShapeType,
    VisualConfig,
} from "chili-core";
import { MeshUtils } from "chili-geo";
import { DoubleSide, Material, Mesh, MeshLambertMaterial } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeVisualObject } from "./threeVisualObject";
import { Constants } from "./constants";

export class ThreeGeometry extends ThreeVisualObject implements IVisualGeometry {
    private _faceMaterial: Material | Material[];
    private _edgeMaterial = new LineMaterial({
        linewidth: 1,
        color: VisualConfig.defaultEdgeColor,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    private _edges?: LineSegments2;
    private _faces?: Mesh;

    constructor(
        readonly geometryNode: GeometryNode,
        readonly context: ThreeVisualContext,
    ) {
        super(geometryNode);
        this._faceMaterial = context.getMaterial(geometryNode.materialId);
        this.generateShape();
        geometryNode.onPropertyChanged(this.handleGeometryPropertyChanged);
    }

    getMainMaterial() {
        return this._faces ? this._faceMaterial : this._edgeMaterial;
    }

    changeFaceMaterial(material: Material | Material[]) {
        if (this._faces) {
            this._faceMaterial = material;
            this._faces.material = material;
        }
    }

    box() {
        return this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox;
    }

    override boundingBox(): BoundingBox | undefined {
        const box = this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox;
        if (!box) return undefined;

        return {
            min: ThreeHelper.toXYZ(box.min),
            max: ThreeHelper.toXYZ(box.max),
        };
    }

    private readonly handleGeometryPropertyChanged = (property: keyof GeometryNode) => {
        if (property === "materialId") {
            this.changeFaceMaterial(this.context.getMaterial(this.geometryNode.materialId));
        } else if ((property as keyof ShapeNode) === "shape") {
            this.removeMeshes();
            this.generateShape();
        }
    };

    private generateShape() {
        const mesh = this.geometryNode.mesh;
        if (mesh?.faces?.position.length) this.initFaces(mesh.faces);
        if (mesh?.edges?.position.length) this.initEdges(mesh.edges);
    }

    override dispose() {
        super.dispose();
        this._edges?.material.dispose();
        this._edgeMaterial = null as any;
        this.geometryNode.removePropertyChanged(this.handleGeometryPropertyChanged);
        this.removeMeshes();
    }

    private removeMeshes() {
        if (this._edges) {
            this.remove(this._edges);
            this._edges.geometry.dispose();
            this._edges = null as any;
        }
        if (this._faces) {
            this.remove(this._faces);
            this._faces.geometry.dispose();
            this._faces = null as any;
        }
    }

    private initEdges(data: EdgeMeshData) {
        const buff = ThreeGeometryFactory.createEdgeBufferGeometry(data);
        this._edges = new LineSegments2(buff, this._edgeMaterial);
        this._edges.layers.set(Constants.Layers.Wireframe);
        this.add(this._edges);
    }

    private initFaces(data: FaceMeshData) {
        const buff = ThreeGeometryFactory.createFaceBufferGeometry(data);
        if (data.groups.length > 1) buff.groups = data.groups;
        this._faces = new Mesh(buff, this._faceMaterial);
        this._faces.layers.set(Constants.Layers.Solid);
        this.add(this._faces);
    }

    setFacesMateiralTemperary(material: MeshLambertMaterial) {
        if (this._faces) this._faces.material = material;
    }

    setEdgesMateiralTemperary(material: LineMaterial) {
        if (this._edges) this._edges.material = material;
    }

    removeTemperaryMaterial(): void {
        if (this._edges) this._edges.material = this._edgeMaterial;
        if (this._faces) this._faces.material = this._faceMaterial;
    }

    cloneSubEdge(index: number) {
        const positions = MeshUtils.subEdge(this.geometryNode.mesh.edges!, index);
        if (!positions) return undefined;

        const buff = new LineSegmentsGeometry();
        buff.setPositions(positions);
        buff.applyMatrix4(this.matrixWorld);

        return new LineSegments2(buff, this._edgeMaterial);
    }

    cloneSubFace(index: number) {
        const mesh = MeshUtils.subFace(this.geometryNode.mesh.faces!, index);
        if (!mesh) return undefined;

        const buff = ThreeGeometryFactory.createFaceBufferGeometry(mesh);
        buff.applyMatrix4(this.matrixWorld);

        return new Mesh(buff, this._faceMaterial);
    }

    faces() {
        return this._faces;
    }

    edges() {
        return this._edges;
    }

    override getSubShapeAndIndex(shapeType: "face" | "edge", subVisualIndex: number) {
        let subShape: ISubShape | undefined = undefined;
        let transform: Matrix4 | undefined = undefined;
        let index: number = -1;
        let groups: ShapeMeshRange[] | undefined = undefined;
        if (shapeType === "edge") {
            groups = this.geometryNode.mesh.edges?.range;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, subVisualIndex)!;
                subShape = groups[index].shape;
                transform = groups[index].transform;
            }
        } else {
            groups = this.geometryNode.mesh.faces?.range;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, subVisualIndex)!;
                subShape = groups[index].shape;
                transform = groups[index].transform;
            }
        }

        let shape: IShape | undefined = subShape;
        if (this.geometryNode instanceof ShapeNode) {
            shape = this.geometryNode.shape.value;
        }
        return { transform, shape, subShape, index, groups: groups ?? [] };
    }

    override subShapeVisual(shapeType: ShapeType): (Mesh | LineSegments2)[] {
        const shapes: (Mesh | LineSegments2 | undefined)[] = [];

        const isWhole =
            shapeType === ShapeType.Shape ||
            ShapeType.hasCompound(shapeType) ||
            ShapeType.hasCompoundSolid(shapeType) ||
            ShapeType.hasSolid(shapeType);

        if (isWhole || ShapeType.hasEdge(shapeType) || ShapeType.hasWire(shapeType)) {
            shapes.push(this.edges());
        }

        if (isWhole || ShapeType.hasFace(shapeType) || ShapeType.hasShell(shapeType)) {
            shapes.push(this.faces());
        }

        return shapes.filter((x) => x !== undefined);
    }

    override wholeVisual(): (Mesh | LineSegments2)[] {
        return [this.edges(), this.faces()].filter((x) => x !== undefined);
    }
}
