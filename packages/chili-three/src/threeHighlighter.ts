// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IHighlighter, IVisualGeometry, ShapeType, VisualState } from "chili-core";

export class ThreeHighlighter implements IHighlighter {
    private readonly _stateMap = new Map<IVisualGeometry, Map<string, VisualState>>();

    clear(): void {
        this._stateMap.forEach((v, k) => {
            this.removeAllStates(k, true);
        });
        this._stateMap.clear();
    }

    removeAllStates(shape: IVisualGeometry, resetState: boolean): void {
        if (!this._stateMap.has(shape)) return;
        this._stateMap.delete(shape);
        if (resetState) shape.resetState();
    }

    updateStateData(
        shape: IVisualGeometry,
        mode: "add" | "remove",
        state: VisualState,
        type: ShapeType,
        index?: number,
    ) {
        let map = this._stateMap.get(shape);
        if (!map) {
            map = new Map();
            this._stateMap.set(shape, map);
        }

        const key = `${type}_${index}`;
        let newState = map.get(key) ?? VisualState.normal;
        if (mode === "add") {
            newState = VisualState.addState(newState, state);
        } else {
            newState = VisualState.removeState(newState, state);
        }
        map.set(key, newState);
        return newState;
    }
}
