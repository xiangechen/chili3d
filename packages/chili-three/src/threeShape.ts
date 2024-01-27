// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Color,
    Config,
    EdgeMeshData,
    FaceMeshData,
    IHighlighter,
    IShape,
    IVisualShape,
    ShapeMeshData,
    ShapeType,
    VisualState,
} from "chili-core";
import {
    AlwaysDepth,
    BufferGeometry,
    DoubleSide,
    EqualDepth,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Material,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Color as ThreeColor,
} from "three";

import { ThreeHelper } from "./threeHelper";

const hilightEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(Config.instance.visual.highlightEdgeColor),
});

const selectedEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(Config.instance.visual.selectedEdgeColor),
});

const highlightFaceMaterial = new MeshStandardMaterial({
    color: ThreeHelper.fromColor(Config.instance.visual.highlightFaceColor),
    side: DoubleSide,
    transparent: true,
    opacity: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
});

const selectedFaceMaterial = new MeshStandardMaterial({
    color: ThreeHelper.fromColor(Config.instance.visual.selectedFaceColor),
    side: DoubleSide,
    transparent: true,
    opacity: 0.32,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
});

export class ThreeShape extends Object3D implements IVisualShape {
    readonly #highlightedFaces: Map<number, Mesh> = new Map();
    readonly #highlightedEdges: Map<number, LineSegments> = new Map();

    private _faceMaterial = new MeshStandardMaterial({
        side: DoubleSide,
        transparent: true,
    });
    private _edgeMaterial = new LineBasicMaterial();
    private _edges?: LineSegments;
    private _faces?: Mesh;

    getMainMaterial() {
        if (this._faces) return this._faceMaterial;
        return this._edgeMaterial;
    }

    set color(color: Color) {
        this.getMainMaterial().color = ThreeHelper.fromColor(color);
    }

    get color(): Color {
        return ThreeHelper.toColor(this.getMainMaterial().color);
    }

    get opacity() {
        return this.getMainMaterial().opacity;
    }

    set opacity(value: number) {
        this.getMainMaterial().opacity = value;
    }

    constructor(
        readonly shape: IShape,
        readonly highlighter: IHighlighter,
    ) {
        super();
        let mesh = this.shape.mesh;
        this.matrixAutoUpdate = false;
        if (mesh.faces?.positions.length) this.add(this.initFaces(mesh.faces));
        if (mesh.edges?.positions.length) this.add(this.initEdges(mesh.edges));
    }

    dispose() {
        if (this._edges) {
            this._edges.geometry.dispose();
        }
        if (this._faces) {
            this._faces.geometry.dispose();
        }
        this._edgeMaterial.dispose();
        this._faceMaterial.dispose();
    }

    private initEdges(data: EdgeMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        this.initColor(data, buff, this._edgeMaterial);
        buff.computeBoundingBox();
        this._edges = new LineSegments(buff, this._edgeMaterial);
        this._edges.renderOrder = 89;
        return this._edges;
    }

    private initFaces(data: FaceMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        buff.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
        buff.setIndex(data.indices);
        this.initColor(data, buff, this._faceMaterial);
        buff.computeBoundingBox();
        this._faces = new Mesh(buff, this._faceMaterial);
        return this._faces;
    }

    private initColor(
        meshData: ShapeMeshData,
        geometry: BufferGeometry,
        material: LineBasicMaterial | MeshStandardMaterial,
    ) {
        if (meshData.color instanceof Array) {
            material.vertexColors = true;
            geometry.setAttribute("color", new Float32BufferAttribute(meshData.color, 3));
        } else {
            material.color = new ThreeColor(meshData.color.toHexStr());
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
            this.setMaterial(newState);
        } else {
            indexes.forEach((index) => {
                let newState = this.highlighter.updateStateData(this, action, state, type, index);
                this.setSubShapeState(type, newState, index);
            });
        }
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

    private setMaterial(newState: VisualState) {
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
        this.#highlightedEdges.forEach((_, index) => this.removeEdge(index));
        this.#highlightedFaces.forEach((_, index) => this.removeFace(index));
        this.#highlightedEdges.clear();
        this.#highlightedFaces.clear();
    }

    private removeEdge(index: number) {
        let edge = this.#highlightedEdges.get(index);
        if (edge) {
            this.remove(edge);
            edge.geometry.dispose();
            this.#highlightedEdges.delete(index);
        }
    }

    private removeFace(index: number) {
        let face = this.#highlightedFaces.get(index);
        if (face) {
            this.remove(face);
            face.geometry.dispose();
            this.#highlightedFaces.delete(index);
        }
    }

    private setSubEdgeState(state: VisualState, index: number) {
        if (!this._edges) return;

        if (state === VisualState.normal) {
            this.removeEdge(index);
            return;
        }

        let material = VisualState.hasState(state, VisualState.selected)
            ? selectedEdgeMaterial
            : hilightEdgeMaterial;
        if (this.#highlightedEdges.has(index)) {
            this.#highlightedEdges.get(index)!.material = material;
        } else {
            let edge = this.cloneSubEdge(index, material);
            this.add(edge);
            this.#highlightedEdges.set(index, edge);
        }
    }

    private cloneSubEdge(index: number, material: LineBasicMaterial) {
        let allPositions = this._edges!.geometry.getAttribute("position") as Float32BufferAttribute;
        let group = this.shape.mesh.edges!.groups[index];
        let positions = allPositions.array.slice(group.start * 3, (group.start + group.count) * 3);
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(positions, 3));
        let edge = new LineSegments(buff, material);
        edge.renderOrder = 99;
        return edge;
    }

    private setSubFaceState(state: VisualState, index: number) {
        if (!this._faces) return;

        if (state === VisualState.normal) {
            this.removeFace(index);
            return;
        }

        let material = VisualState.hasState(state, VisualState.selected)
            ? selectedFaceMaterial
            : highlightFaceMaterial;
        if (this.#highlightedFaces.has(index)) {
            this.#highlightedFaces.get(index)!.material = material;
        } else {
            let face = this.cloneSubFace(index, material);
            if (face) {
                this.add(face);
                this.#highlightedFaces.set(index, face);
            }
        }
    }

    private cloneSubFace(index: number, material: MeshStandardMaterial) {
        let group = this.shape.mesh.faces!.groups[index];
        if (!group) return undefined;
        let allPositions = this._faces!.geometry.getAttribute("position") as Float32BufferAttribute;
        let allNormals = this._faces!.geometry.getAttribute("normal") as Float32BufferAttribute;
        let allIndices = this.shape.mesh.faces!.indices;
        let indices = allIndices.slice(group.start, group.start + group.count);
        let indiceStart = Math.min(...indices);
        let indiceEnd = Math.max(...indices) + 1;
        let positions = allPositions.array.slice(indiceStart * 3, indiceEnd * 3);
        let normals = allNormals.array.slice(indiceStart * 3, indiceEnd * 3);
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(positions, 3));
        buff.setAttribute("normal", new Float32BufferAttribute(normals, 3));
        buff.setIndex(indices.map((i) => i - indiceStart));
        let face = new Mesh(buff, material);
        face.renderOrder = 99;
        return face;
    }

    faces() {
        return this._faces;
    }

    edges() {
        return this._edges;
    }
}
