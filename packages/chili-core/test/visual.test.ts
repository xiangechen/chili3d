// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { VisualState } from "../src";

describe("visual test", () => {
    test("test VisualState", () => {
        let state = VisualState.normal;
        expect(state).toBe(0);

        state = VisualState.addState(state, VisualState.edgeHighlight);
        expect(state).toBe(1);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeFalsy();

        state = VisualState.addState(state, VisualState.edgeSelected);
        expect(state).toBe(3);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualState.removeState(state, VisualState.edgeHighlight);
        expect(state).toBe(2);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualState.removeState(state, VisualState.edgeSelected);
        expect(state).toBe(0);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeFalsy();

        state = VisualState.edgeHighlight;
        state = VisualState.addState(state, VisualState.edgeSelected);
        expect(state).toBe(3);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualState.removeState(state, VisualState.edgeHighlight);
        expect(state).toBe(2);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeTruthy();
    });
});
