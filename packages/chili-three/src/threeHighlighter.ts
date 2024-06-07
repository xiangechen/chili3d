// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IHighlighter, IVisualGeometry, ShapeType, VisualConfig, VisualState } from "chili-core";
import { DoubleSide, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial } from "three";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";

const hilightEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    linewidth: 2,
});

const selectedEdgeMaterial = new LineBasicMaterial({
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
    linewidth: 2,
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
    private readonly _highlightedFaces: Map<number, Mesh> = new Map();
    private readonly _highlightedEdges: Map<number, LineSegments> = new Map();
    private readonly _states: Map<string, VisualState> = new Map();

    constructor(readonly geometry: ThreeGeometry) {}

    getState(type: ShapeType, index?: number) {
        const key = `${type}_${index}`;
        return this._states.get(key);
    }

    addState(state: VisualState, type: ShapeType, index?: number) {
        return this.updateState("add", state, type, index);
    }

    removeState(state: VisualState, type: ShapeType, index?: number) {
        return this.updateState("remove", state, type, index);
    }

    private updateState(method: "add" | "remove", state: VisualState, type: ShapeType, index?: number) {
        const key = `${type}_${index}`;

        let newState = this._states.get(key);
        if (newState === undefined) {
            if (method === "remove") return VisualState.normal;
            newState = state;
        } else {
            let func = method === "add" ? VisualState.addState : VisualState.removeState;
            newState = func(newState, state);
        }

        this._states.set(key, newState);
        this.displayState(type, newState, index);
        return newState;
    }

    private displayState(type: ShapeType, newState: VisualState, index: number | undefined) {
        if (ShapeType.isWhole(type)) {
            this.setGeometryState(newState);
        } else if (index !== undefined) {
            this.setSubGeometryState(type, newState, index);
        }
    }

    private setGeometryState(newState: VisualState) {
        if (newState === VisualState.normal) {
            this.geometry.removeTemperaryMaterial();
        } else {
            let { faceMaterial, edgeMaterial } = this.getShapeMaterial(newState);
            this.geometry.setFacesMateiralTemperary(faceMaterial);
            this.geometry.setEdgesMateiralTemperary(edgeMaterial);
        }
    }

    resetState() {
        this._highlightedEdges.forEach((_, index) => this.removeEdge(index));
        this._highlightedFaces.forEach((_, index) => this.removeFace(index));
        this._highlightedEdges.clear();
        this._highlightedFaces.clear();
        this.geometry.removeTemperaryMaterial();
    }

    private removeEdge(index: number) {
        let edge = this._highlightedEdges.get(index);
        if (edge) {
            this.geometry.remove(edge);
            edge.geometry.dispose();
            this._highlightedEdges.delete(index);
        }
    }

    private removeFace(index: number) {
        let face = this._highlightedFaces.get(index);
        if (face) {
            this.geometry.remove(face);
            face.geometry.dispose();
            this._highlightedFaces.delete(index);
        }
    }

    private setSubGeometryState(type: ShapeType, newState: VisualState, index: number) {
        if (ShapeType.hasFace(type) || ShapeType.hasShell(type)) {
            this.setSubFaceState(newState, index);
        }
        if (ShapeType.hasEdge(type) || ShapeType.hasWire(type)) {
            this.setSubEdgeState(newState, index);
        }
    }

    private getShapeMaterial(newState: VisualState) {
        let faceMaterial = highlightFaceMaterial;
        let edgeMaterial = hilightEdgeMaterial;
        if (VisualState.hasState(newState, VisualState.selected)) {
            faceMaterial = selectedFaceMaterial;
            edgeMaterial = selectedEdgeMaterial;
        }
        return { faceMaterial, edgeMaterial };
    }

    private setSubEdgeState(state: VisualState, index: number) {
        if (state === VisualState.normal) {
            this.removeEdge(index);
            return;
        }

        let material = this.getEdgeStateMaterial(state);
        if (this._highlightedEdges.has(index)) {
            this._highlightedEdges.get(index)!.material = material;
            return;
        }

        let edge = this.geometry.cloneSubEdge(index, material);
        if (edge) {
            edge.renderOrder = 99;
            this.geometry.add(edge);
            this._highlightedEdges.set(index, edge);
        }
    }

    private setSubFaceState(state: VisualState, index: number) {
        if (state === VisualState.normal) {
            this.removeFace(index);
            return;
        }

        let material = this.getFaceStateMaterial(state);
        if (this._highlightedFaces.has(index)) {
            this._highlightedFaces.get(index)!.material = material;
            return;
        }

        let face = this.geometry.cloneSubFace(index, material);
        if (face) {
            face.renderOrder = 99;
            this.geometry.add(face);
            this._highlightedFaces.set(index, face);
        }
    }

    getEdgeStateMaterial(state: VisualState) {
        return VisualState.hasState(state, VisualState.selected)
            ? selectedEdgeMaterial
            : hilightEdgeMaterial;
    }

    getFaceStateMaterial(state: VisualState) {
        return VisualState.hasState(state, VisualState.selected)
            ? selectedFaceMaterial
            : highlightFaceMaterial;
    }
}

export class ThreeHighlighter implements IHighlighter {
    private readonly _stateMap = new Map<IVisualGeometry, GeometryState>();

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
        if (ShapeType.isWhole(type) || index.length === 0) {
            geometryState.addState(state, type);
        } else {
            index.forEach((i) => {
                geometryState.addState(state, type, i);
            });
        }
    }

    removeState(geometry: IVisualGeometry, state: VisualState, type: ShapeType, ...index: number[]) {
        let geometryState = this.getOrInitState(geometry);
        if (ShapeType.isWhole(type) || index.length === 0) {
            geometryState.removeState(state, type);
        } else {
            index.forEach((i) => {
                geometryState.removeState(state, type, i);
            });
        }
    }

    private getOrInitState(geometry: IVisualGeometry) {
        let geometryState = this._stateMap.get(geometry);
        if (!geometryState) {
            geometryState = new GeometryState(geometry as ThreeGeometry);
            this._stateMap.set(geometry, geometryState);
        }
        return geometryState;
    }
}
