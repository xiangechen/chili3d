// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IHighlighter, IVisualShape, ShapeType, VisualState } from "chili-core";

export class ThreeHighlighter implements IHighlighter {
    readonly #stateMap = new Map<IVisualShape, Map<string, VisualState>>();

    clear(): void {
        this.#stateMap.forEach((v, k) => {
            this.removeAllStates(k, true);
        });
        this.#stateMap.clear();
    }

    removeAllStates(shape: IVisualShape, resetState: boolean): void {
        if (!this.#stateMap.has(shape)) return;
        this.#stateMap.get(shape)!.clear();
        this.#stateMap.delete(shape);
        if (resetState) shape.resetState();
    }

    updateStateData(
        shape: IVisualShape,
        mode: "add" | "remove",
        state: VisualState,
        type: ShapeType,
        index?: number,
    ) {
        let map = this.#stateMap.get(shape);
        if (!map) {
            map = new Map();
            this.#stateMap.set(shape, map);
        }

        const key = `${type}_${index}`;
        let newState = map.get(key);
        if (!newState) {
            newState = state;
        } else if (mode === "add") {
            newState = VisualState.addState(newState, state);
        } else {
            newState = VisualState.removeState(newState, state);
        }
        map.set(key, newState);
        return newState;
    }
}
