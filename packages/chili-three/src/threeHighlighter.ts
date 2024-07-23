// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IDisposable,
    IHighlighter,
    IVisualGeometry,
    ShapeMeshData,
    ShapeType,
    VisualConfig,
    VisualState,
} from "chili-core";
import {
    DoubleSide,
    Group,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    Object3D,
    Points,
    Scene,
} from "three";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import { ThreeGeometryFactory } from "./threeGeometryFactory";

const hilightEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
});

const selectedEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
});

const highlightFaceMaterial = new MeshLambertMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightFaceColor),
    side: DoubleSide,
    transparent: true,
    opacity: 0.85,
});

const selectedFaceMaterial = new MeshLambertMaterial({
    color: ThreeHelper.fromColor(VisualConfig.selectedFaceColor),
    side: DoubleSide,
    transparent: true,
    opacity: 0.32,
});

export class GeometryState {
    private readonly _states: Map<string, [VisualState, LineSegments | Mesh]> = new Map();

    constructor(
        readonly highlighter: ThreeHighlighter,
        readonly geometry: ThreeGeometry,
    ) {}

    getState(type: ShapeType, index?: number) {
        const key = this.state_key(type, index);
        return this._states.get(key)?.[0];
    }

    private state_key(type: ShapeType, index?: number) {
        return `${type}_${index}`;
    }

    addState(state: VisualState, type: ShapeType, index: number[]) {
        this.updateState("add", state, type, index);
    }

    removeState(state: VisualState, type: ShapeType, index: number[]) {
        this.updateState("remove", state, type, index);
    }

    private updateStates(
        key: string,
        method: "add" | "remove",
        state: VisualState,
    ): [VisualState | undefined, VisualState] {
        let oldState = this._states.get(key)?.[0];
        let newState = oldState;
        if (newState === undefined) {
            if (method === "remove") return [undefined, VisualState.normal];
            newState = state;
        } else {
            let func = method === "add" ? VisualState.addState : VisualState.removeState;
            newState = func(newState, state);
        }
        return [oldState, newState];
    }

    private updateState(method: "add" | "remove", state: VisualState, type: ShapeType, index: number[]) {
        if (ShapeType.isWhole(type)) {
            this.setWholeState(method, state, type);
        } else if (index.length > 0) {
            this.setSubGeometryState(method, state, type, index);
        }
    }

    private setWholeState(method: "add" | "remove", state: VisualState, type: ShapeType) {
        const key = this.state_key(type);
        let [oldState, newState] = this.updateStates(key, method, state);
        if (newState === VisualState.normal) {
            this.geometry.removeTemperaryMaterial();
        } else if (VisualState.hasState(newState, VisualState.highlighter)) {
            this.geometry.setEdgesMateiralTemperary(hilightEdgeMaterial);
        } else if (VisualState.hasState(newState, VisualState.selected)) {
            this.geometry.setEdgesMateiralTemperary(selectedEdgeMaterial);
        }

        this._states.set(key, [newState, this.geometry as any]);
    }

    private addSceneItem(scene: Scene, items: Object3D[]) {
        let itemsToAdd = items.filter((x) => !scene.children.includes(x));
        scene.children.push(...itemsToAdd);
    }

    private removeSceneItem(scene: Scene, items: Object3D[]) {
        scene.children = scene.children.filter((x) => !items.includes(x));
    }

    resetState() {
        let hovers: (LineSegments | Mesh)[] = [];
        let selected: (LineSegments | Mesh)[] = [];
        this._states.forEach((state, key) => {
            if (VisualState.hasState(state[0], VisualState.highlighter)) {
                hovers.push(state[1]);
            }
            if (VisualState.hasState(state[0], VisualState.selected)) {
                selected.push(state[1]);
            }
        });

        this.removeSceneItem(this.highlighter.sceneHorver, hovers);
        this.removeSceneItem(this.highlighter.sceneSelected, selected);
        hovers.forEach((x) => x.geometry?.dispose());
        selected.forEach((x) => x.geometry?.dispose());

        this._states.clear();
    }

    private setSubGeometryState(
        method: "add" | "remove",
        state: VisualState,
        type: ShapeType,
        index: number[],
    ) {
        let addToHover: Object3D[] = [];
        let addToSelected: Object3D[] = [];
        let removeFromHover: Object3D[] = [];
        let removeFromSelected: Object3D[] = [];

        index.forEach((i) => {
            let key = this.state_key(type, i);
            let [oldState, newState] = this.updateStates(key, method, state);
            this.addStateToRemove(key, oldState, newState, removeFromHover, removeFromSelected);
            this.addStateToAdd(type, newState, key, i, addToHover, addToSelected);
        });

        this.removeSceneItem(this.highlighter.sceneHorver, removeFromHover);
        this.removeSceneItem(this.highlighter.sceneSelected, removeFromSelected);
        this.addSceneItem(this.highlighter.sceneHorver, addToHover);
        this.addSceneItem(this.highlighter.sceneSelected, addToSelected);
    }

    private addStateToRemove(
        key: string,
        oldState: VisualState | undefined,
        newState: VisualState,
        removeFromHover: Object3D[],
        removeFromSelected: Object3D[],
    ) {
        let item = this._states.get(key)?.[1];
        if (!item) return;

        if (oldState !== undefined && !VisualState.hasState(newState, VisualState.highlighter)) {
            removeFromHover.push(item);
        }
        if (oldState !== undefined && !VisualState.hasState(newState, VisualState.selected)) {
            removeFromSelected.push(item);
        }
        if (newState === VisualState.normal) this._states.delete(key);
    }

    private addStateToAdd(
        type: ShapeType,
        newState: VisualState,
        key: string,
        i: number,
        addToHover: Object3D[],
        addToSelected: Object3D[],
    ) {
        let item = this.getOrCloneGeometry(type, key, i);
        if (!item) return;
        if (VisualState.hasState(newState, VisualState.highlighter)) {
            addToHover.push(item);
        }
        if (VisualState.hasState(newState, VisualState.selected)) {
            addToSelected.push(item);
        }
        this._states.set(key, [newState, item]);
    }

    private getOrCloneGeometry(type: ShapeType, key: string, index: number) {
        let geometry = this._states.get(key)?.[1];
        if (geometry !== undefined) return geometry;
        if (ShapeType.hasFace(type) || ShapeType.hasShell(type)) {
            return this.geometry.cloneSubFace(index);
        }
        if (ShapeType.hasEdge(type) || ShapeType.hasWire(type)) {
            return this.geometry.cloneSubEdge(index);
        }

        console.warn(`Invalid type ${type} for ${key}`);
        return undefined;
    }
}

export class ThreeHighlighter implements IHighlighter {
    private readonly _stateMap = new Map<IVisualGeometry, GeometryState>();

    readonly tempShapes: Group = new Group();
    readonly sceneHorver: Scene = new Scene();
    readonly sceneSelected: Scene = new Scene();

    constructor() {
        this.sceneHorver.add(this.tempShapes);
    }

    clear(): void {
        this._stateMap.forEach((v, k) => {
            this.resetState(k);
        });
        this._stateMap.clear();
    }

    resetState(geometry: IVisualGeometry): void {
        if (!this._stateMap.has(geometry)) return;
        let geometryState = this._stateMap.get(geometry);
        geometryState!.resetState();
        this._stateMap.delete(geometry);
    }

    getState(shape: IVisualGeometry, type: ShapeType, index?: number): VisualState | undefined {
        if (this._stateMap.has(shape)) {
            return this._stateMap.get(shape)!.getState(type, index);
        }
        return undefined;
    }

    addState(geometry: IVisualGeometry, state: VisualState, type: ShapeType, ...index: number[]) {
        let geometryState = this.getOrInitState(geometry);
        geometryState.addState(state, type, index);
    }

    removeState(geometry: IVisualGeometry, state: VisualState, type: ShapeType, ...index: number[]) {
        let geometryState = this.getOrInitState(geometry);
        geometryState.removeState(state, type, index);
    }

    private getOrInitState(geometry: IVisualGeometry) {
        let geometryState = this._stateMap.get(geometry);
        if (!geometryState) {
            geometryState = new GeometryState(this, geometry as ThreeGeometry);
            this._stateMap.set(geometry, geometryState);
        }
        return geometryState;
    }

    highliteMesh(...datas: ShapeMeshData[]): number {
        let group = new Group();
        datas.forEach((data) => {
            if (ShapeMeshData.isVertex(data)) {
                group.add(ThreeGeometryFactory.createVertexGeometry(data));
            } else if (ShapeMeshData.isEdge(data)) {
                group.add(ThreeGeometryFactory.createEdgeGeometry(data));
            } else if (ShapeMeshData.isFace(data)) {
                group.add(ThreeGeometryFactory.createFaceGeometry(data));
            }
        });
        this.tempShapes.add(group);
        return group.id;
    }

    removeMesh(id: number) {
        let shape = this.tempShapes.getObjectById(id);
        if (shape === undefined) return;
        shape.children.forEach((x) => {
            if (x instanceof Mesh || x instanceof LineSegments || x instanceof Points) {
                x.geometry.dispose();
                x.material.dispose();
            }
            if (IDisposable.isDisposable(x)) {
                x.dispose();
            }
        });
        shape.children.length = 0;
        this.tempShapes.remove(shape);
    }
}
