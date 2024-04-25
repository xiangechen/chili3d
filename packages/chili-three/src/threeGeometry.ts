// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    EdgeMeshData,
    FaceMeshData,
    GeometryEntity,
    IHighlighter,
    IVisualGeometry,
    MathUtils,
    Matrix4,
    ShapeMeshData,
    ShapeType,
    VisualConfig,
    VisualState,
} from "chili-core";
import {
    AlwaysDepth,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Material,
    Mesh,
    MeshLambertMaterial,
    Object3D,
    Color as ThreeColor,
} from "three";

import { ThreeHelper } from "./threeHelper";
import { ThreeVisualContext } from "./threeVisualContext";

const hilightEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    linewidth: 2,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    depthFunc: AlwaysDepth,
});

const selectedEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
    linewidth: 2,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    depthFunc: AlwaysDepth,
});

const highlightFaceMaterial = new MeshLambertMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightFaceColor),
    side: DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthFunc: AlwaysDepth,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
});

const selectedFaceMaterial = new MeshLambertMaterial({
    color: ThreeHelper.fromColor(VisualConfig.selectedFaceColor),
    side: DoubleSide,
    transparent: true,
    opacity: 0.32,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
});

export class ThreeGeometry extends Object3D implements IVisualGeometry {
    private readonly _highlightedFaces: Map<number, Mesh> = new Map();
    private readonly _highlightedEdges: Map<number, LineSegments> = new Map();

    private _faceMaterial: Material;
    private _edgeMaterial = new LineBasicMaterial();
    private _edges?: LineSegments;
    private _faces?: Mesh;

    getMainMaterial() {
        if (this._faces) return this._faceMaterial;
        return this._edgeMaterial;
    }

    setFaceMaterial(material: Material) {
        if (this._faces) {
            this._faceMaterial = material;
            this._faces.material = material;
        }
    }

    get transform() {
        return ThreeHelper.toMatrix(this.matrix);
    }

    set transform(value: Matrix4) {
        this.matrix.fromArray(value.toArray());
    }

    constructor(
        readonly geometryEngity: GeometryEntity,
        readonly highlighter: IHighlighter,
        readonly context: ThreeVisualContext,
    ) {
        super();
        this.transform = geometryEngity.matrix;
        this._faceMaterial = context.getMaterial(geometryEngity.materialId);
        this.matrixAutoUpdate = false;
        this.generateShape();
        geometryEngity.onPropertyChanged(this.handleGeometryPropertyChanged);
    }

    boundingBox() {
        return this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox ?? undefined;
    }

    private handleGeometryPropertyChanged = (property: keyof GeometryEntity) => {
        if (property === "matrix") {
            this.transform = this.geometryEngity.matrix;
        } else if (property === "materialId") {
            let material = this.context.getMaterial(this.geometryEngity.materialId)!;
            this.setFaceMaterial(material);
        } else if (property === "shape") {
            this.removeSubShapes();
            this.generateShape();
        }
    };

    private generateShape() {
        let mesh = this.geometryEngity.shape.value?.mesh;
        if (mesh?.faces?.positions.length) this.add(this.initFaces(mesh.faces));
        if (mesh?.edges?.positions.length) this.add(this.initEdges(mesh.edges));
    }

    dispose() {
        this.removeSubShapes();
        this.geometryEngity.removePropertyChanged(this.handleGeometryPropertyChanged);
        this._edgeMaterial.dispose();
        this.resetState();
    }

    private removeSubShapes() {
        if (this._edges) {
            this.remove(this._edges);
            this._edges.geometry.dispose();
            this._edges = undefined;
        }
        if (this._faces) {
            this.remove(this._faces);
            this._faces.geometry.dispose();
            this._faces = undefined;
        }
    }

    private initEdges(data: EdgeMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        this.initColor(data, buff, this._edgeMaterial);
        buff.computeBoundingBox();
        this._edges = new LineSegments(buff, this._edgeMaterial);
        return this._edges;
    }

    private initFaces(data: FaceMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        buff.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
        buff.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
        buff.setIndex(data.indices);
        // this.initColor(data, buff, this._faceMaterial);
        buff.computeBoundingBox();
        this._faces = new Mesh(buff, this._faceMaterial);
        return this._faces;
    }

    private initColor(
        meshData: ShapeMeshData,
        geometry: BufferGeometry,
        material: LineBasicMaterial | MeshLambertMaterial,
    ) {
        if (meshData.color instanceof Array) {
            material.vertexColors = true;
            geometry.setAttribute("color", new Float32BufferAttribute(meshData.color, 3));
        } else {
            material.color = new ThreeColor(meshData.color);
        }
    }

    addState(state: VisualState, type: ShapeType, ...indexes: number[]) {
        this.removeOrAddState("add", state, type, ...indexes);
    }

    removeState(state: VisualState, type: ShapeType, ...indexes: number[]) {
        this.removeOrAddState("remove", state, type, ...indexes);
    }

    private removeOrAddState(
        action: "remove" | "add",
        state: VisualState,
        type: ShapeType,
        ...indexes: number[]
    ) {
        if (type === ShapeType.Shape) {
            let newState = this.highlighter.updateStateData(this, action, state, type);
            this.setStateMaterial(newState);
            return;
        }
        indexes.forEach((index) => {
            let newState = this.highlighter.updateStateData(this, action, state, type, index);
            this.setSubShapeState(type, newState, index);
        });
    }

    private setSubShapeState(type: ShapeType, newState: VisualState, index: number) {
        if (ShapeType.hasFace(type)) {
            if (this._faces) this.setSubFaceState(newState, index);
        }
        if (ShapeType.hasEdge(type) || ShapeType.hasWire(type)) {
            if (this._edges) this.setSubEdgeState(newState, index);
        }
        // TODO: other type
    }

    private setStateMaterial(newState: VisualState) {
        if (this._faces) {
            let faceMaterial = this._faceMaterial;
            if (VisualState.hasState(newState, VisualState.selected)) {
                faceMaterial = selectedFaceMaterial;
            } else if (VisualState.hasState(newState, VisualState.highlight)) {
                faceMaterial = highlightFaceMaterial;
            }
            this._faces.material = faceMaterial;
        }
        if (this._edges) {
            let edgeMaterial: Material = this._edgeMaterial;
            if (VisualState.hasState(newState, VisualState.selected)) {
                edgeMaterial = selectedEdgeMaterial;
            } else if (VisualState.hasState(newState, VisualState.highlight)) {
                edgeMaterial = hilightEdgeMaterial;
            }
            this._edges.material = edgeMaterial;
        }
    }

    resetState(): void {
        this.highlighter.removeAllStates(this, false);
        if (this._edges) this._edges.material = this._edgeMaterial;
        if (this._faces) this._faces.material = this._faceMaterial;
        this._highlightedEdges.forEach((_, index) => this.removeEdge(index));
        this._highlightedFaces.forEach((_, index) => this.removeFace(index));
        this._highlightedEdges.clear();
        this._highlightedFaces.clear();
    }

    private removeEdge(index: number) {
        let edge = this._highlightedEdges.get(index);
        if (edge) {
            this.remove(edge);
            edge.geometry.dispose();
            this._highlightedEdges.delete(index);
        }
    }

    private removeFace(index: number) {
        let face = this._highlightedFaces.get(index);
        if (face) {
            this.remove(face);
            face.geometry.dispose();
            this._highlightedFaces.delete(index);
        }
    }

    private setSubEdgeState(state: VisualState, index: number) {
        if (!this._edges) return;

        if (state === VisualState.normal) {
            this.removeEdge(index);
            return;
        }

        let material = getEdgeStateMaterial(state);
        if (this._highlightedEdges.has(index)) {
            this._highlightedEdges.get(index)!.material = material;
            return;
        }

        let edge = this.cloneSubEdge(index, material);
        edge.renderOrder = 99;
        this.add(edge);
        this._highlightedEdges.set(index, edge);
    }

    private cloneSubEdge(index: number, material: LineBasicMaterial) {
        let allPositions = this._edges!.geometry.getAttribute("position") as Float32BufferAttribute;
        let group = this.geometryEngity.shape.value!.mesh.edges!.groups[index];
        let positions = allPositions.array.slice(group.start * 3, (group.start + group.count) * 3);
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(positions, 3));
        return new LineSegments(buff, material);
    }

    private setSubFaceState(state: VisualState, index: number) {
        if (!this._faces) return;

        if (state === VisualState.normal) {
            this.removeFace(index);
            return;
        }

        let material = getFaceStateMaterial(state);
        if (this._highlightedFaces.has(index)) {
            this._highlightedFaces.get(index)!.material = material;
            return;
        }

        let face = this.cloneSubFace(index, material);
        if (face) {
            face.renderOrder = 99;
            this.add(face);
            this._highlightedFaces.set(index, face);
        }
    }

    private cloneSubFace(index: number, material: MeshLambertMaterial) {
        let group = this.geometryEngity.shape.value?.mesh.faces!.groups[index];
        if (!group) return undefined;

        let allPositions = this._faces!.geometry.getAttribute("position") as Float32BufferAttribute;
        let allNormals = this._faces!.geometry.getAttribute("normal") as Float32BufferAttribute;
        let allIndices = this.geometryEngity.shape.value!.mesh.faces!.indices;
        let indices = allIndices.slice(group.start, group.start + group.count);
        let minMax = MathUtils.minMax(indices);
        let indiceStart = minMax!.min;
        let indiceEnd = minMax!.max + 1;
        let positions = allPositions.array.slice(indiceStart * 3, indiceEnd * 3);
        let normals = allNormals.array.slice(indiceStart * 3, indiceEnd * 3);

        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(positions, 3));
        buff.setAttribute("normal", new Float32BufferAttribute(normals, 3));
        buff.setIndex(indices.map((i) => i - indiceStart));
        return new Mesh(buff, material);
    }

    faces() {
        return this._faces;
    }

    edges() {
        return this._edges;
    }
}
function getEdgeStateMaterial(state: VisualState) {
    return VisualState.hasState(state, VisualState.selected) ? selectedEdgeMaterial : hilightEdgeMaterial;
}

function getFaceStateMaterial(state: VisualState) {
    return VisualState.hasState(state, VisualState.selected) ? selectedFaceMaterial : highlightFaceMaterial;
}
