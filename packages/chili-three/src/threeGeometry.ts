// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type BoundingBox,
    type EdgeMeshData,
    type FaceMeshData,
    type GeometryNode,
    type IShape,
    type ISubShape,
    type IVisualGeometry,
    type Matrix4,
    MeshUtils,
    type ShapeMeshRange,
    ShapeNode,
    ShapeType,
    ShapeTypeUtils,
    type VertexMeshData,
} from "chili-core";
import { type Material, Mesh, type MeshLambertMaterial, Points, type PointsMaterial } from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { defaultEdgeMaterial, defaultVertexMaterial } from "./common";
import { Constants } from "./constants";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import type { ThreeVisualContext } from "./threeVisualContext";
import { ThreeVisualObject } from "./threeVisualObject";

export class ThreeGeometry extends ThreeVisualObject implements IVisualGeometry {
    private _faceMaterial: Material | Material[];
    private _edges?: LineSegments2;
    private _faces?: Mesh;
    private _vertexs?: Points;

    constructor(
        readonly geometryNode: GeometryNode,
        readonly context: ThreeVisualContext,
    ) {
        super(geometryNode);
        this._faceMaterial = context.getMaterial(geometryNode.materialId);
        this.generateShape();
        geometryNode.onPropertyChanged(this.handleGeometryPropertyChanged);
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
        if (mesh?.vertexs?.position.length) this.initVertexs(mesh.vertexs);
        if (mesh?.faces?.position.length) this.initFaces(mesh.faces);
        if (mesh?.edges?.position.length) this.initEdges(mesh.edges);
    }

    override dispose() {
        super.dispose();
        this.geometryNode.removePropertyChanged(this.handleGeometryPropertyChanged);
        this.removeMeshes();
    }

    private removeMeshes() {
        if (this._vertexs) {
            this.remove(this._vertexs);
            this._vertexs.geometry.dispose();
            this._vertexs = null as any;
        }
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

    private initVertexs(data: VertexMeshData) {
        const buff = ThreeGeometryFactory.createVertexBufferGeometry(data);
        this._vertexs = new Points(buff, defaultVertexMaterial);
        this._vertexs.layers.set(Constants.Layers.Wireframe);
        this.add(this._vertexs);
    }

    private initEdges(data: EdgeMeshData) {
        const buff = ThreeGeometryFactory.createEdgeBufferGeometry(data);
        this._edges = new LineSegments2(buff, defaultEdgeMaterial);
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

    setVertexsMateiralTemperary(material: PointsMaterial) {
        if (this._vertexs) this._vertexs.material = material;
    }

    removeTemperaryMaterial(): void {
        if (this._vertexs) this._vertexs.material = defaultVertexMaterial;
        if (this._edges) this._edges.material = defaultEdgeMaterial;
        if (this._faces) this._faces.material = this._faceMaterial;
    }

    cloneSubEdge(index: number) {
        const positions = MeshUtils.subEdge(this.geometryNode.mesh.edges!, index);
        if (!positions) return undefined;

        const buff = new LineSegmentsGeometry();
        buff.setPositions(positions);
        buff.applyMatrix4(this.matrixWorld);

        return new LineSegments2(buff, defaultEdgeMaterial);
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

    vertexs() {
        return this._vertexs;
    }

    override getSubShapeAndIndex(shapeType: "face" | "edge" | "vertex", subVisualIndex: number) {
        let subShape: ISubShape | undefined;
        let transform: Matrix4 | undefined;
        let index: number = -1;
        let groups: ShapeMeshRange[] | undefined;
        if (shapeType === "vertex") {
            groups = this.geometryNode.mesh.vertexs?.range;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, subVisualIndex)!;
                subShape = groups[index].shape;
                transform = groups[index].transform;
            }
        } else if (shapeType === "edge") {
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

    override subShapeVisual(shapeType: ShapeType): (Mesh | LineSegments2 | Points)[] {
        const shapes: (Mesh | LineSegments2 | Points | undefined)[] = [];

        const isWhole =
            shapeType === ShapeType.Shape ||
            ShapeTypeUtils.hasCompound(shapeType) ||
            ShapeTypeUtils.hasCompoundSolid(shapeType) ||
            ShapeTypeUtils.hasSolid(shapeType);

        if (isWhole || ShapeTypeUtils.hasVertex(shapeType)) {
            shapes.push(this.vertexs());
        }

        if (isWhole || ShapeTypeUtils.hasEdge(shapeType) || ShapeTypeUtils.hasWire(shapeType)) {
            shapes.push(this.edges());
        }

        if (isWhole || ShapeTypeUtils.hasFace(shapeType) || ShapeTypeUtils.hasShell(shapeType)) {
            shapes.push(this.faces());
        }

        return shapes.filter((x) => x !== undefined);
    }

    override wholeVisual(): (Mesh | LineSegments2 | Points)[] {
        return [this.edges(), this.faces(), this.vertexs()].filter((x) => x !== undefined);
    }
}
