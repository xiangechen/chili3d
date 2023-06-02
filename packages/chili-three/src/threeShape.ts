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
    MeshLambertMaterial,
    Group,
    BufferAttribute,
} from "three";
import { MeshBVH } from "three-mesh-bvh";

import { ThreeHelper } from "./threeHelper";
import { Constants } from "./constants";

let hilightEdgeMaterial = new LineBasicMaterial({ color: 0xcfcf00 });
let selectedEdgeMaterial = new LineBasicMaterial({ color: 0xabab00 });

let hilightFaceMaterial = new MeshLambertMaterial({
    color: 0xabab00,
    side: DoubleSide,
    transparent: true,
});

let selectedFaceMaterial = new MeshLambertMaterial({
    color: 0x343400,
    side: DoubleSide,
    transparent: true,
});

export class ThreeShape extends Object3D implements IVisualShape {
    private readonly _stateMap = new Map<string, VisualState>();
    private _faceMaterial: MeshBasicMaterial = new MeshBasicMaterial();
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
        data.groups.forEach((x) => buff.addGroup(x.start, x.count));
        buff.computeBoundingSphere();
        this._edges = new LineSegments(buff, [this._edgeMaterial, hilightEdgeMaterial, selectedEdgeMaterial]);
        this._edges.userData[Constants.GroupsKey] = data.groups;
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
