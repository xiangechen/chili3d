// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Color,
    EdgeMeshData,
    FaceMeshData,
    IShape,
    IVisualShape,
    MeshData,
    MeshGroup,
    ShapeType,
    VisualState,
} from "chili-core";
import {
    BufferGeometry,
    Color as ThreeColor,
    Float32BufferAttribute,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    LineSegments,
    DoubleSide,
} from "three";
import { MeshBVH } from "three-mesh-bvh";

import { ThreeHelper } from "./threeHelper";
import { Constants } from "./constants";

let hilightEdgeMaterial = new LineBasicMaterial({ color: 0xcfcf00 });
let selectedEdgeMaterial = new LineBasicMaterial({ color: 0xabab00 });

let hilightFaceMaterial = new MeshBasicMaterial({ color: 0xabab00 });
let selectedFaceMaterial = new MeshBasicMaterial({ color: 0x343400 });

export class ThreeShape extends Object3D implements IVisualShape {
    private readonly _stateMap = new Map<string, VisualState>();

    private _faceMaterial: MeshBasicMaterial = new MeshBasicMaterial({
        side: DoubleSide,
        transparent: true,
    });
    private _edgeMaterial = new LineBasicMaterial();
    private _edges?: LineSegments;
    private _faces?: Mesh;

    transparency: number = 1;

    constructor(readonly shape: IShape) {
        super();
        this.userData[Constants.ShapeKey] = this.shape;
        let mesh = this.shape.mesh();
        if (mesh.edges !== undefined) this.add(this.initEdges(mesh.edges));
        if (mesh.faces !== undefined) this.add(this.initFaces(mesh.faces));
    }

    private initEdges(data: EdgeMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        this.initColor(data, buff, this._edgeMaterial);
        buff.addGroup(0, data.positions.length / 3);
        buff.computeBoundingBox();
        this._edges = new LineSegments(buff, [this._edgeMaterial, hilightEdgeMaterial, selectedEdgeMaterial]);
        this._edges.userData[Constants.GroupsKey] = data.groups;
        return this._edges;
    }

    private initFaces(data: FaceMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        buff.setAttribute("normals", new Float32BufferAttribute(data.normals, 3));
        buff.setIndex(data.indices);
        buff.addGroup(0, data.indices.length);
        this.initColor(data, buff, this._faceMaterial);
        buff.computeBoundingBox();
        this._faces = new Mesh(buff, [this._faceMaterial, hilightFaceMaterial, selectedFaceMaterial]);
        this._faces.userData[Constants.GroupsKey] = data.groups;
        return this._faces;
    }

    private initColor(
        meshData: MeshData,
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
        if (type === ShapeType.Shape) {
            this._edges?.geometry.clearGroups();
            this._faces?.geometry.clearGroups();
            if (this._faces) this.setFaceState(newState, 0, this.getIndicesCount(this._faces));
            if (this._edges) this.setEdgeState(newState, 0, this.getIndicesCount(this._edges));
        } else {
        }
    }

    removeState(state: VisualState, type: ShapeType, index?: number) {
        let newState = this.updateState("remove", state, type, index);
        if (type === ShapeType.Shape) {
            this._edges?.geometry.clearGroups();
            this._faces?.geometry.clearGroups();
            if (this._faces) this.setFaceState(newState, 0, this.getIndicesCount(this._faces));
            if (this._edges) this.setEdgeState(newState, 0, this.getIndicesCount(this._edges));
        } else {
        }
    }

    private updateState(mode: "add" | "remove", state: VisualState, type: ShapeType, index?: number) {
        let key = this.stateMapKey(type, index);
        let newState = this._stateMap.get(key);
        if (newState === undefined) {
            newState = state;
        } else {
            newState =
                mode === "add"
                    ? VisualState.addState(newState, state)
                    : VisualState.removeState(newState, state);
        }
        this._stateMap.set(key, newState);
        return newState;
    }

    private stateMapKey(type: ShapeType, index?: number) {
        return `${type}-${index}`;
    }

    resetState(): void {
        this._stateMap.clear();
        this._edges?.geometry.clearGroups();
        this._faces?.geometry.clearGroups();
        this._edges?.geometry.addGroup(0, this.getIndicesCount(this._edges));
        this._faces?.geometry.addGroup(0, this.getIndicesCount(this._faces));
    }

    private setEdgeState(state: VisualState, start: number, count: number) {
        if (VisualState.hasState(state, VisualState.selected)) {
            this._edges?.geometry.addGroup(start, count, 2);
        } else if (VisualState.hasState(state, VisualState.hilight)) {
            this._edges?.geometry.addGroup(start, count, 1);
        } else {
            this._edges?.geometry.addGroup(start, count, 0);
        }
    }

    private setFaceState(state: VisualState, start: number, count: number) {
        if (VisualState.hasState(state, VisualState.selected)) {
            this._faces?.geometry.addGroup(start, count, 2);
        } else if (VisualState.hasState(state, VisualState.hilight)) {
            this._faces?.geometry.addGroup(start, count, 1);
        } else {
            this._faces?.geometry.addGroup(start, count, 0);
        }
    }

    private getIndicesCount(data: LineSegments | Mesh) {
        if (data instanceof LineSegments) {
            return data.geometry.getAttribute("position").array.length / 3;
        } else {
            return data.geometry.index!.array.length;
        }
    }

    selectedState(type: ShapeType, index: number) {
        if (type === ShapeType.Shape) {
            this._faceMaterial.color.set(0xff0000);
        } else {
            let group = undefined;
            if (type === ShapeType.Edge) {
                group = this._edges?.geometry.groups.at(index);
            } else if (type === ShapeType.Face) {
                group = this._faces?.geometry.groups.at(index);
            }
            if (group !== undefined) group.materialIndex = 2;
        }
    }

    hilightedState(type: ShapeType, index: number) {
        if (type === ShapeType.Shape) {
            this._edgeMaterial.color.set(0xff0000);
        } else {
            let group = undefined;
            if (type === ShapeType.Edge) {
                group = this._edges?.geometry.groups.at(index);
            } else if (type === ShapeType.Face) {
                group = this._faces?.geometry.groups.at(index);
            }
            if (group !== undefined) group.materialIndex = 1;
        }
    }

    normalState(type: ShapeType, index: number) {
        if (type === ShapeType.Shape) {
            this._faceMaterial.color.set(0x00ff00);
            this._edgeMaterial.color.set(0x00ff00);
        } else {
            let edge = this._edges?.geometry.groups.at(index);
            if (edge !== undefined) edge.materialIndex = 0;
            let face = this._faces?.geometry.groups.at(index);
            if (face !== undefined) face.materialIndex = 0;
        }
    }

    set color(color: Color) {
        this._faceMaterial.color = ThreeHelper.fromColor(color);
    }

    get color(): Color {
        return ThreeHelper.toColor(this._faceMaterial.color);
    }

    face(faceIndex: number): IShape | undefined {
        let groups: MeshGroup[] = this._faces?.userData[Constants.GroupsKey];
        return groups.find(ThreeHelper.groupFinder(faceIndex))?.shape;
    }

    edge(index: number): IShape | undefined {
        let groups: MeshGroup[] = this._edges?.userData[Constants.GroupsKey];
        return groups.find(ThreeHelper.groupFinder(index))?.shape;
    }

    faces() {
        return this._faces;
    }

    edges() {
        return this._edges;
    }
}
