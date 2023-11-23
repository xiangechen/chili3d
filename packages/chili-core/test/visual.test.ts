// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { VisualState } from "../src";

describe("visual test", () => {
    test("test VisualState", () => {
        let state = VisualState.normal;
        expect(state).toBe(0);

        state = VisualState.addState(state, VisualState.highlight);
        expect(state).toBe(1);
        expect(VisualState.hasState(state, VisualState.highlight)).toBeTruthy();
        expect(VisualState.hasState(state, VisualState.selected)).toBeFalsy();

        state = VisualState.addState(state, VisualState.selected);
        expect(state).toBe(3);
        expect(VisualState.hasState(state, VisualState.highlight)).toBeTruthy();
        expect(VisualState.hasState(state, VisualState.selected)).toBeTruthy();

        state = VisualState.removeState(state, VisualState.highlight);
        expect(state).toBe(2);
        expect(VisualState.hasState(state, VisualState.highlight)).toBeFalsy();
        expect(VisualState.hasState(state, VisualState.selected)).toBeTruthy();

        state = VisualState.removeState(state, VisualState.selected);
        expect(state).toBe(0);
        expect(VisualState.hasState(state, VisualState.highlight)).toBeFalsy();
        expect(VisualState.hasState(state, VisualState.selected)).toBeFalsy();
    });
});
