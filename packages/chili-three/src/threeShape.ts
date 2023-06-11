// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Color,
    Config,
    EdgeMeshData,
    FaceMeshData,
    IShape,
    IVisualShape,
    ShapeMeshData,
    ShapeType,
    VisualState,
} from "chili-core";
import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Color as ThreeColor,
} from "three";

import { Constants } from "./constants";
import { ThreeHelper } from "./threeHelper";

let hilightEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(Config.instance.visual.highlightEdgeColor),
});

let selectedEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(Config.instance.visual.selectedEdgeColor),
});

let hilightFaceMaterial = new MeshBasicMaterial({
    color: ThreeHelper.fromColor(Config.instance.visual.highlightFaceColor),
    side: DoubleSide,
    transparent: true,
});

let selectedFaceMaterial = new MeshBasicMaterial({
    color: ThreeHelper.fromColor(Config.instance.visual.selectedFaceColor),
    side: DoubleSide,
    transparent: true,
});

export class ThreeShape extends Object3D implements IVisualShape {
    private readonly _stateMap = new Map<string, VisualState>();
    private _faceMaterial: MeshBasicMaterial = new MeshBasicMaterial({
        side: DoubleSide,
        transparent: true,
    });
    private _edgeMaterial = new LineBasicMaterial();
    private _edges?: LineSegments;
    private _faces?: Mesh;

    set color(color: Color) {
        this._faceMaterial.color = ThreeHelper.fromColor(color);
    }

    get color(): Color {
        return ThreeHelper.toColor(this._faceMaterial.color);
    }

    get transparency() {
        return this._faceMaterial.opacity;
    }

    set transparency(value: number) {
        this._faceMaterial.opacity = value;
    }

    constructor(readonly shape: IShape) {
        super();
        let mesh = this.shape.mesh;
        if (mesh.faces !== undefined) this.add(this.initFaces(mesh.faces));
        if (mesh.edges !== undefined) this.add(this.initEdges(mesh.edges));
    }

    private initEdges(data: EdgeMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        this.initColor(data, buff, this._edgeMaterial);
        data.groups.forEach((x) => buff.addGroup(x.start, x.count));
        buff.computeBoundingSphere();
        this._edges = new LineSegments(buff, [
            this._edgeMaterial,
            hilightEdgeMaterial,
            selectedEdgeMaterial,
        ]);
        this._edges.renderOrder = 99;
        return this._edges;
    }

    private initFaces(data: FaceMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        buff.setAttribute("normals", new Float32BufferAttribute(data.normals, 3));
        buff.setIndex(data.indices);
        data.groups.forEach((x) => buff.addGroup(x.start, x.count, 0));
        this.initColor(data, buff, this._faceMaterial);
        buff.computeBoundingSphere();
        this._faces = new Mesh(buff, [this._faceMaterial, hilightFaceMaterial, selectedFaceMaterial]);
        return this._faces;
    }

    private initColor(
        meshData: ShapeMeshData,
        geometry: BufferGeometry,
        material: LineBasicMaterial | MeshBasicMaterial
    ) {
        if (meshData.color instanceof Array) {
            material.vertexColors = true;
            geometry.setAttribute("color", new Float32BufferAttribute(meshData.color, 3));
        } else {
            material.color = new ThreeColor(meshData.color.toHexStr());
        }
    }

    addState(state: VisualState, type: ShapeType, index?: number) {
        let newState = this.updateState("add", state, type, index);
        this.setState(type, newState, index);
    }

    removeState(state: VisualState, type: ShapeType, index?: number) {
        let newState = this.updateState("remove", state, type, index);
        this.setState(type, newState, index);
    }

    private setState(type: ShapeType, newState: VisualState, index: number | undefined) {
        const setFaceState = () => {
            if (this._faces) this.setGroupsMaterial(this._faces.geometry, newState, index);
        };
        const setEdgeState = () => {
            if (this._edges) this.setGroupsMaterial(this._edges.geometry, newState, index);
        };
        if (type === ShapeType.Shape) {
            setFaceState();
            setEdgeState();
        } else if (index !== undefined) {
            if (type === ShapeType.Face) {
                setFaceState();
            } else if (type === ShapeType.Edge && this._edges) {
                setEdgeState();
            }
        }
    }

    private updateState(mode: "add" | "remove", state: VisualState, type: ShapeType, index?: number) {
        const key = `${type}_${index}`;
        let newState = this._stateMap.get(key);
        if (!newState) {
            newState = state;
        } else {
            if (mode === "add") {
                newState = VisualState.addState(newState, state);
            } else {
                newState = VisualState.removeState(newState, state);
            }
        }
        this._stateMap.set(key, newState);
        return newState;
    }

    resetState(): void {
        this._stateMap.clear();
        this._edges?.geometry.groups.forEach((g) => {
            if (g.materialIndex !== 0) g.materialIndex = 0;
        });
        this._faces?.geometry.groups.forEach((g) => {
            if (g.materialIndex !== 0) g.materialIndex = 0;
        });
    }

    private setGroupsMaterial(buff: BufferGeometry, state: VisualState, index?: number) {
        let materialIndex = 0;
        if (VisualState.hasState(state, VisualState.selected)) {
            materialIndex = 2;
        } else if (VisualState.hasState(state, VisualState.hilight)) {
            materialIndex = 1;
        }

        if (index === undefined) {
            buff.groups.forEach((g) => {
                if (g.materialIndex !== materialIndex) g.materialIndex = materialIndex;
            });
        } else {
            let g = buff.groups.at(index);
            if (g !== undefined && g.materialIndex !== materialIndex) g.materialIndex = materialIndex;
        }
    }

    faces() {
        return this._faces;
    }

    edges() {
        return this._edges;
    }
}
