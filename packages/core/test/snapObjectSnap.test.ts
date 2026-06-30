// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, ObjectSnapTypes } from "../src";
import { XYZ } from "../src/math";
import { ObjectSnap } from "../src/snap/snaps/objectSnap";
import { createMockView, createMouseAndDetected, TestDocument } from "./mocks";

// ============================================================================
// ObjectSnap
// ============================================================================

describe("ObjectSnap", () => {
    let originalEnableSnap: boolean;

    beforeEach(() => {
        originalEnableSnap = Config.instance.enableSnap;
    });

    afterEach(() => {
        Config.instance.enableSnap = originalEnableSnap;
    });

    test("should be created with snap type and optional reference point", () => {
        const snap = new ObjectSnap(ObjectSnapTypes.vertex);
        expect(snap).toBeDefined();
        expect(typeof snap.snap).toBe("function");
    });

    test("should be created with snap type and reference point", () => {
        const refPoint = () => new XYZ({ x: 5, y: 0, z: 0 });
        const snap = new ObjectSnap(ObjectSnapTypes.endPoint, refPoint);
        expect(snap).toBeDefined();
    });

    test("should return undefined when snap is disabled", () => {
        Config.instance.enableSnap = false;

        const snap = new ObjectSnap(ObjectSnapTypes.vertex);
        const view = createMockView();
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeUndefined();
    });

    test("should return undefined when no shapes and no invisible snaps", () => {
        const snap = new ObjectSnap(ObjectSnapTypes.vertex);
        const view = createMockView();
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeUndefined();
    });

    test("clear should clean up all resources", () => {
        const snap = new ObjectSnap(ObjectSnapTypes.vertex);
        expect(() => snap.clear()).not.toThrow();
    });

    test("removeDynamicObject should clean up temp resources", () => {
        const snap = new ObjectSnap(ObjectSnapTypes.vertex);
        expect(() => snap.removeDynamicObject()).not.toThrow();
    });

    test("handleSnaped should be a function", () => {
        const snap = new ObjectSnap(ObjectSnapTypes.vertex);
        expect(typeof snap.handleSnaped).toBe("function");
    });
});
