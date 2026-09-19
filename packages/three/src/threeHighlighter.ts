// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IHighlighter,
    isDisposable,
    MeshDataUtils,
    MeshUtils,
    type ShapeMeshData,
    type ShapeType,
    ShapeTypeUtils,
    type VisualState,
    VisualStates,
    VisualStateUtils,
} from "@chili3d/core";
import { Group, Mesh, Points } from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { isHighlightable } from "./highlightable";
import {
    faceTransparentMaterial,
    highlightFaceMaterial,
    highlightVertexMaterial,
    hilightEdgeMaterial,
    selectedEdgeMaterial,
    selectedFaceColoredMaterial,
    selectedVertexMaterial,
} from "./materials";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import type { ThreeVisualContext } from "./threeVisualContext";
import type { ThreeVisualObject } from "./threeVisualObject";

/**
 * State of one visual, whole or per sub-shape. A sub-shape keeps the fill and the
 * outline it is drawn with as separate objects, so a single state can ask for both —
 * a selected face that also shows its boundary — and dropping either flag takes that
 * part's object away.
 */
interface SubGeometryState {
    state: VisualState;
    face?: Mesh;
    edge?: LineSegments2;
}

export class GeometryState {
    private readonly _states = new Map<string, SubGeometryState>();

    constructor(
        readonly highlighter: ThreeHighlighter,
        readonly visual: ThreeVisualObject,
    ) {}

    getState(type: ShapeType, index?: number) {
        const key = this.state_key(type, index);
        return this._states.get(key)?.state;
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
        if (index.length === 0 || ShapeTypeUtils.isWhole(type)) {
            this.setWholeState(method, state, type);
        } else {
            this.setSubGeometryState(method, state, type, index);
        }
    }

    /**
     * State of a whole visual. Its fill and its outline are independent, so each part
     * the state asks for is applied on its own: `removeTemperaryMaterial` first puts
     * every part back on its own material, and the wanted parts are set from there.
     */
    private setWholeState(method: "add" | "remove", state: VisualState, type: ShapeType) {
        const key = this.state_key(type);
        const [_oldState, newState] = this.updateStates(key, method, state);
        if (this.visual instanceof ThreeGeometry) {
            this.visual.removeTemperaryMaterial();
            if (VisualStateUtils.hasState(newState, VisualStates.edgeHighlight)) {
                this.visual.setVertexsMateiralTemperary(highlightVertexMaterial);
                this.visual.setEdgesMateiralTemperary(hilightEdgeMaterial);
            } else if (VisualStateUtils.hasState(newState, VisualStates.edgeSelected)) {
                this.visual.setVertexsMateiralTemperary(selectedVertexMaterial);
                this.visual.setEdgesMateiralTemperary(selectedEdgeMaterial);
            }
            if (VisualStateUtils.hasState(newState, VisualStates.faceTransparent)) {
                this.visual.setFacesMateiralTemperary(faceTransparentMaterial);
            } else if (VisualStateUtils.hasState(newState, VisualStates.faceHighlight)) {
                this.visual.setFacesMateiralTemperary(highlightFaceMaterial);
            }
        } else if (isHighlightable(this.visual)) {
            if (newState !== VisualStates.normal) {
                this.visual.highlight();
            } else {
                this.visual.unhighlight();
            }
        }

        this._states.set(key, { state: newState });
    }

    private updateStates(
        key: string,
        method: "add" | "remove",
        state: VisualState,
    ): [VisualState | undefined, VisualState] {
        const oldState = this._states.get(key)?.state;
        let newState = oldState;
        if (newState === undefined) {
            if (method === "remove") return [undefined, VisualStates.normal];
            newState = state;
        } else {
            const func = method === "add" ? VisualStateUtils.addState : VisualStateUtils.removeState;
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
        } else if (isHighlightable(this.visual)) {
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
            if (oldState !== undefined && newState === VisualStates.normal) {
                shouldRemoved.push(key);
            } else {
                this.applySubState(type, key, i, newState);
            }
        });

        shouldRemoved.forEach((key) => {
            const item = this._states.get(key);
            if (item !== undefined) {
                this.removeSubObject(item.face);
                this.removeSubObject(item.edge);
                this._states.delete(key);
            }
        });
    }

    /**
     * Applies the fill and the outline the state asks for, each on an object of its own:
     * a state carrying both — a selected face that also shows its boundary — gets both,
     * and a part the state dropped is taken away. The outline of a face comes from the
     * face's own mesh, so the caller never has to name its edges.
     */
    private applySubState(type: ShapeType, key: string, index: number, newState: VisualState) {
        const previous = this._states.get(key);
        const face = this.subFacePart(previous?.face, type, key, index, newState);
        const edge = this.subEdgePart(previous?.edge, type, key, index, newState);
        // a state nothing could be drawn for — a visual with no sub-shape geometry, or an
        // index naming none — is not recorded
        if (face === undefined && edge === undefined) {
            this._states.delete(key);
            return;
        }
        this._states.set(key, { state: newState, face, edge });
    }

    /** The fill object of the state: the one already there re-materialed, a new one, or none. */
    private subFacePart(
        existing: Mesh | undefined,
        type: ShapeType,
        key: string,
        index: number,
        state: VisualState,
    ): Mesh | undefined {
        if (!hasFaces(type) || !hasFaceState(state)) {
            this.removeSubObject(existing);
            return undefined;
        }
        const face = existing ?? this.createSubFace(type, key, index);
        if (face === undefined) return undefined;
        face.material = faceStateMaterial(state);
        face.renderOrder = 999;
        return face;
    }

    /** The outline object of the state: the one already there re-materialed, a new one, or none. */
    private subEdgePart(
        existing: LineSegments2 | undefined,
        type: ShapeType,
        key: string,
        index: number,
        state: VisualState,
    ): LineSegments2 | undefined {
        const material = this.edgeMaterialOf(state, type);
        if (material === undefined) {
            this.removeSubObject(existing);
            return undefined;
        }
        const edge = existing ?? this.createSubEdge(type, key, index);
        if (edge === undefined) return undefined;
        edge.material = material;
        return edge;
    }

    /**
     * Material of the outline a state draws for a sub-shape, or none. A face draws its
     * boundary only when the state names it with an edge bit; an edge or wire has no fill
     * to draw, so there a state asking only for a fill — the hover or selection a pick
     * over edges and faces passes down — becomes the matching outline.
     */
    private edgeMaterialOf(state: VisualState, type: ShapeType): LineMaterial | undefined {
        const isEdge = ShapeTypeUtils.hasEdge(type) || ShapeTypeUtils.hasWire(type);
        if (!isEdge && !hasFaces(type)) return undefined;
        if (VisualStateUtils.hasState(state, VisualStates.edgeHighlight)) return hilightEdgeMaterial;
        if (VisualStateUtils.hasState(state, VisualStates.edgeSelected)) return selectedEdgeMaterial;
        if (!isEdge) return undefined;
        if (VisualStateUtils.hasState(state, VisualStates.faceHighlight)) return hilightEdgeMaterial;
        if (VisualStateUtils.hasState(state, VisualStates.faceSelected)) return selectedEdgeMaterial;
        return undefined;
    }

    private createSubEdge(type: ShapeType, key: string, index: number) {
        if (!(this.visual instanceof ThreeGeometry)) return undefined;

        let points: Float32Array | undefined;
        if (hasFaces(type)) {
            points = MeshUtils.subFaceOutlines(this.visual.geometryNode.mesh.faces!, index);
        }
        if (points === undefined && (ShapeTypeUtils.hasEdge(type) || ShapeTypeUtils.hasWire(type))) {
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

    private createSubFace(type: ShapeType, key: string, index: number) {
        if (!(this.visual instanceof ThreeGeometry)) return undefined;

        let face: Mesh | undefined;
        if (hasFaces(type)) {
            face = this.visual.cloneSubFace(index);
        }

        if (!face) {
            console.warn(`Invalid type ${type} for ${key}`);
            return undefined;
        }

        this.highlighter.container.add(face);
        return face;
    }

    private removeSubObject(object: Mesh | LineSegments2 | undefined) {
        if (object === undefined) return;
        this.highlighter.container.remove(object);
        object.geometry?.dispose();
    }
}

/** Whether the type is drawn with faces: a face itself, a shell or a solid. */
function hasFaces(type: ShapeType): boolean {
    return ShapeTypeUtils.hasFace(type) || ShapeTypeUtils.hasShell(type) || ShapeTypeUtils.hasSolid(type);
}

/** Whether the state asks for a fill: a ghost, a hover highlight or a selection. */
function hasFaceState(state: VisualState): boolean {
    return (
        VisualStateUtils.hasState(state, VisualStates.faceTransparent) ||
        VisualStateUtils.hasState(state, VisualStates.faceHighlight) ||
        VisualStateUtils.hasState(state, VisualStates.faceSelected)
    );
}

/** Fill material of a state: the ghost tint, the selection colour, or the hover highlight. */
function faceStateMaterial(state: VisualState) {
    if (VisualStateUtils.hasState(state, VisualStates.faceTransparent)) return faceTransparentMaterial;
    if (VisualStateUtils.hasState(state, VisualStates.faceSelected)) return selectedFaceColoredMaterial;
    return highlightFaceMaterial;
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
        const geometryState = this._stateMap.get(geometry);
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
        const geometryState = this.getOrInitState(geometry);
        geometryState.addState(state, type, index);
    }

    removeState(geometry: ThreeVisualObject, state: VisualState, type: ShapeType, ...index: number[]) {
        const geometryState = this.getOrInitState(geometry);
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
        const group = new Group();
        datas.forEach((data) => {
            if (MeshDataUtils.isVertexMesh(data)) {
                group.add(ThreeGeometryFactory.createVertexGeometry(data));
            } else if (MeshDataUtils.isEdgeMesh(data)) {
                group.add(ThreeGeometryFactory.createEdgeGeometry(data));
            } else if (MeshDataUtils.isFaceMesh(data)) {
                group.add(ThreeGeometryFactory.createFaceGeometry(data));
            }
        });
        this.container.add(group);
        return group.id;
    }

    removeHighlightMesh(id: number) {
        const shape = this.container.getObjectById(id);
        if (shape === undefined) return;
        shape.children.forEach((x) => {
            if (x instanceof Mesh || x instanceof LineSegments2 || x instanceof Points) {
                x.geometry.dispose();
                x.material.dispose();
            }
            if (isDisposable(x)) {
                x.dispose();
            }
        });
        shape.children.length = 0;
        this.container.remove(shape);
    }
}
