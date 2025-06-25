// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDisposable, IHighlighter, ShapeMeshData, ShapeType, VisualState } from "chili-core";
import { MeshUtils } from "chili-geo";
import { Group, Mesh, Points } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";
import {
    faceColoredMaterial,
    faceTransparentMaterial,
    hilightEdgeMaterial,
    selectedEdgeMaterial,
} from "./common";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeMeshObject, ThreeVisualObject } from "./threeVisualObject";
import { IHighlightable } from "./highlightable";

export class GeometryState {
    private readonly _states: Map<string, [VisualState, LineSegments2 | undefined]> = new Map();

    constructor(
        readonly highlighter: ThreeHighlighter,
        readonly visual: ThreeVisualObject,
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

    private updateState(method: "add" | "remove", state: VisualState, type: ShapeType, index: number[]) {
        if (ShapeType.isWhole(type)) {
            this.setWholeState(method, state, type);
        } else if (index.length > 0) {
            this.setSubGeometryState(method, state, type, index);
        }
    }

    private setWholeState(method: "add" | "remove", state: VisualState, type: ShapeType) {
        const key = this.state_key(type);
        let [_oldState, newState] = this.updateStates(key, method, state);
        if (this.visual instanceof ThreeGeometry) {
            if (newState === VisualState.normal) {
                this.visual.removeTemperaryMaterial();
            } else if (VisualState.hasState(newState, VisualState.edgeHighlight)) {
                this.visual.setEdgesMateiralTemperary(hilightEdgeMaterial);
            } else if (VisualState.hasState(newState, VisualState.edgeSelected)) {
                this.visual.setEdgesMateiralTemperary(selectedEdgeMaterial);
            } else if (VisualState.hasState(newState, VisualState.faceTransparent)) {
                this.visual.removeTemperaryMaterial();
                this.visual.setFacesMateiralTemperary(faceTransparentMaterial);
            } else if (VisualState.hasState(newState, VisualState.faceColored)) {
                this.visual.removeTemperaryMaterial();
                this.visual.setFacesMateiralTemperary(faceColoredMaterial);
            }
        } else if (IHighlightable.is(this.visual)) {
            if (newState !== VisualState.normal) {
                this.visual.highlight();
            } else {
                this.visual.unhighlight();
            }
        }

        this._states.set(key, [newState, undefined]);
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

    resetState() {
        this.highlighter.container.children.forEach((x) => {
            (x as any).geometry?.dispose();
        });
        this.highlighter.container.clear();
        if (this.visual instanceof ThreeGeometry) {
            this.visual.removeTemperaryMaterial();
        } else if (this.visual instanceof ThreeMeshObject) {
            this.visual.unhighlight();
        }
        this._states.clear();
    }

    private setSubGeometryState(
        method: "add" | "remove",
        state: VisualState,
        type: ShapeType,
        index: number[],
    ) {
        const shouldRemoved: string[] = [];
        index.forEach((i) => {
            const key = this.state_key(type, i);
            const [oldState, newState] = this.updateStates(key, method, state);
            if (oldState !== undefined && newState === VisualState.normal) {
                shouldRemoved.push(key);
            } else {
                this.addSubEdgeState(type, key, i, newState);
            }
        });

        shouldRemoved.forEach((key) => {
            const item = this._states.get(key)?.[1];
            if (item) {
                this.highlighter.container.remove(item);
                item.geometry?.dispose();
                this._states.delete(key);
            }
        });
    }

    private addSubEdgeState(type: ShapeType, key: string, i: number, newState: VisualState) {
        const geometry = this.getOrCloneGeometry(type, key, i);
        if (geometry && "material" in geometry) {
            let material = VisualState.hasState(newState, VisualState.edgeHighlight)
                ? hilightEdgeMaterial
                : selectedEdgeMaterial;
            geometry.material = material;
            this._states.set(key, [newState, geometry]);
        }
    }

    private getOrCloneGeometry(type: ShapeType, key: string, index: number) {
        if (!(this.visual instanceof ThreeGeometry)) return undefined;

        const geometry = this._states.get(key)?.[1];
        if (geometry) return geometry;

        let points: Float32Array | undefined = undefined;
        if (ShapeType.hasFace(type) || ShapeType.hasShell(type)) {
            points = MeshUtils.subFaceOutlines(this.visual.geometryNode.mesh.faces!, index);
        }
        if (points === undefined && (ShapeType.hasEdge(type) || ShapeType.hasWire(type))) {
            points = MeshUtils.subEdge(this.visual.geometryNode.mesh.edges!, index);
        }

        if (!points) {
            console.warn(`Invalid type ${type} for ${key}`);
            return undefined;
        }

        const lineGeometry = new LineSegmentsGeometry();
        lineGeometry.setPositions(points);
        const segment = new LineSegments2(lineGeometry);
        this.highlighter.container.add(segment);
        segment.applyMatrix4(this.visual.matrixWorld);
        return segment;
    }
}

export class ThreeHighlighter implements IHighlighter {
    private readonly _stateMap = new Map<ThreeVisualObject, GeometryState>();
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

    resetState(geometry: ThreeVisualObject): void {
        if (!this._stateMap.has(geometry)) return;
        let geometryState = this._stateMap.get(geometry);
        geometryState!.resetState();
        this._stateMap.delete(geometry);
    }

    getState(shape: ThreeVisualObject, type: ShapeType, index?: number): VisualState | undefined {
        if (this._stateMap.has(shape)) {
            return this._stateMap.get(shape)!.getState(type, index);
        }
        return undefined;
    }

    addState(geometry: ThreeVisualObject, state: VisualState, type: ShapeType, ...index: number[]) {
        let geometryState = this.getOrInitState(geometry);
        geometryState.addState(state, type, index);
    }

    removeState(geometry: ThreeVisualObject, state: VisualState, type: ShapeType, ...index: number[]) {
        let geometryState = this.getOrInitState(geometry);
        geometryState.removeState(state, type, index);
    }

    private getOrInitState(geometry: ThreeVisualObject) {
        let geometryState = this._stateMap.get(geometry);
        if (!geometryState) {
            geometryState = new GeometryState(this, geometry);
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
