// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IDisposable,
    IHighlighter,
    IVisualGeometry,
    ShapeMeshData,
    ShapeType,
    VisualState,
} from "chili-core";
import { MeshUtils } from "chili-geo";
import { Group, Mesh, Points } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";
import { hilightEdgeMaterial, selectedEdgeMaterial } from "./common";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeVisualContext } from "./threeVisualContext";

export class GeometryState {
    private readonly _states: Map<string, [VisualState, LineSegments2]> = new Map();

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

    resetState() {
        this.highlighter.container.children.forEach((x) => {
            (x as any).geometry?.dispose();
        });
        this.highlighter.container.clear();
        this._states.clear();
    }

    private setSubGeometryState(
        method: "add" | "remove",
        state: VisualState,
        type: ShapeType,
        index: number[],
    ) {
        let shouldRemoved: string[] = [];
        index.forEach((i) => {
            let key = this.state_key(type, i);
            let [oldState, newState] = this.updateStates(key, method, state);
            if (oldState !== undefined && newState === VisualState.normal) {
                shouldRemoved.push(key);
            } else {
                let geometry = this.getOrCloneGeometry(type, key, i);
                if (geometry) {
                    let material = VisualState.hasState(newState, VisualState.highlighter)
                        ? hilightEdgeMaterial
                        : selectedEdgeMaterial;
                    geometry.material = material;
                    this._states.set(key, [newState, geometry]);
                }
            }
        });

        shouldRemoved.forEach((key) => {
            let item = this._states.get(key)?.[1];
            if (item) {
                this.highlighter.container.remove(item);
                item.geometry?.dispose();
                this._states.delete(key);
            }
        });
    }

    private getOrCloneGeometry(type: ShapeType, key: string, index: number) {
        let geometry = this._states.get(key)?.[1];
        if (geometry !== undefined) return geometry;

        let points: number[] | undefined = undefined;
        if (ShapeType.hasFace(type) || ShapeType.hasShell(type)) {
            points = MeshUtils.subFaceOutlines(this.geometry.geometryEngity.shape.ok().mesh.faces!, index);
        }
        if (points === undefined && (ShapeType.hasEdge(type) || ShapeType.hasWire(type))) {
            points = MeshUtils.subEdge(this.geometry.geometryEngity.shape.ok().mesh.edges!, index);
        }

        if (!points) {
            console.warn(`Invalid type ${type} for ${key}`);
            return undefined;
        }

        let lineGeometry = new LineSegmentsGeometry();
        lineGeometry.setPositions(points);
        let segment = new LineSegments2(lineGeometry);
        this.highlighter.container.add(segment);
        segment.applyMatrix4(this.geometry.matrixWorld);
        return segment;
    }
}

export class ThreeHighlighter implements IHighlighter {
    private readonly _stateMap = new Map<IVisualGeometry, GeometryState>();
    readonly container: Group;

    constructor(readonly content: ThreeVisualContext) {
        this.container = new Group();
        this.container.name = "highlighter";
        this.content.scene.add(this.container);
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

    highlightMesh(...datas: ShapeMeshData[]): number {
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
        this.container.add(group);
        return group.id;
    }

    removeHighlightMesh(id: number) {
        let shape = this.container.getObjectById(id);
        if (shape === undefined) return;
        shape.children.forEach((x) => {
            if (x instanceof Mesh || x instanceof LineSegments2 || x instanceof Points) {
                x.geometry.dispose();
                x.material.dispose();
            }
            if (IDisposable.isDisposable(x)) {
                x.dispose();
            }
        });
        shape.children.length = 0;
        this.container.remove(shape);
    }
}
