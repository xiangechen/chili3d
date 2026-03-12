// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BoundingBox, GeometryNode, Matrix4, VisualState } from "../src";
import { VisualStates, VisualStateUtils } from "../src";
import { type IVisualGeometry, type IVisualObject, isVisualGeometry } from "../src/visual/visualObject";

describe("visual test", () => {
    test("test VisualState", () => {
        let state: VisualState = VisualStates.normal;
        expect(state).toBe(0);

        state = VisualStateUtils.addState(state, VisualStates.edgeHighlight);
        expect(state).toBe(1);
        expect(VisualStateUtils.hasState(state, VisualStates.edgeHighlight)).toBeTruthy();
        expect(VisualStateUtils.hasState(state, VisualStates.edgeSelected)).toBeFalsy();

        state = VisualStateUtils.addState(state, VisualStates.edgeSelected);
        expect(state).toBe(3);
        expect(VisualStateUtils.hasState(state, VisualStates.edgeHighlight)).toBeTruthy();
        expect(VisualStateUtils.hasState(state, VisualStates.edgeSelected)).toBeTruthy();

        state = VisualStateUtils.removeState(state, VisualStates.edgeHighlight);
        expect(state).toBe(2);
        expect(VisualStateUtils.hasState(state, VisualStates.edgeHighlight)).toBeFalsy();
        expect(VisualStateUtils.hasState(state, VisualStates.edgeSelected)).toBeTruthy();

        state = VisualStateUtils.removeState(state, VisualStates.edgeSelected);
        expect(state).toBe(0);
        expect(VisualStateUtils.hasState(state, VisualStates.edgeHighlight)).toBeFalsy();
        expect(VisualStateUtils.hasState(state, VisualStates.edgeSelected)).toBeFalsy();

        state = VisualStates.edgeHighlight;
        state = VisualStateUtils.addState(state, VisualStates.edgeSelected);
        expect(state).toBe(3);
        expect(VisualStateUtils.hasState(state, VisualStates.edgeHighlight)).toBeTruthy();
        expect(VisualStateUtils.hasState(state, VisualStates.edgeSelected)).toBeTruthy();

        state = VisualStateUtils.removeState(state, VisualStates.edgeHighlight);
        expect(state).toBe(2);
        expect(VisualStateUtils.hasState(state, VisualStates.edgeHighlight)).toBeFalsy();
        expect(VisualStateUtils.hasState(state, VisualStates.edgeSelected)).toBeTruthy();
    });
});

describe("isVisualGeometry", () => {
    // Mock objects for testing
    const mockGeometryNode: GeometryNode = {} as GeometryNode;
    const mockMatrix: Matrix4 = {} as Matrix4;

    class MockVisualGeometry implements IVisualGeometry {
        visible = true;
        transform = mockMatrix;
        disposed = false;

        get geometryNode(): GeometryNode {
            return mockGeometryNode;
        }

        worldTransform(): Matrix4 {
            return mockMatrix;
        }

        boundingBox(): BoundingBox | undefined {
            return undefined;
        }

        dispose(): void {
            this.disposed = true;
        }
    }

    class MockVisualObject implements IVisualObject {
        visible = true;
        transform = mockMatrix;
        disposed = false;

        worldTransform(): Matrix4 {
            return mockMatrix;
        }

        boundingBox(): BoundingBox | undefined {
            return undefined;
        }

        dispose(): void {
            this.disposed = true;
        }
    }

    test("should return true for IVisualGeometry object", () => {
        const visualGeometry = new MockVisualGeometry();
        expect(isVisualGeometry(visualGeometry)).toBe(true);
    });

    test("should return false for regular IVisualObject", () => {
        const visualObject = new MockVisualObject();
        expect(isVisualGeometry(visualObject)).toBe(false);
    });

    test("should return false for object with undefined geometryNode", () => {
        const objectWithUndefinedGeometry = {
            visible: true,
            transform: mockMatrix,
            geometryNode: undefined,
            worldTransform: () => mockMatrix,
            boundingBox: () => undefined,
            dispose: () => {},
        } as IVisualObject;
        expect(isVisualGeometry(objectWithUndefinedGeometry)).toBe(false);
    });

    test("should return false for object without geometryNode property", () => {
        const objectWithoutGeometryNode = {
            visible: true,
            transform: mockMatrix,
            worldTransform: () => mockMatrix,
            boundingBox: () => undefined,
            dispose: () => {},
        } as IVisualObject;
        expect(isVisualGeometry(objectWithoutGeometryNode)).toBe(false);
    });

    test("should return true for object with null geometryNode", () => {
        const objectWithNullGeometry = {
            visible: true,
            transform: mockMatrix,
            geometryNode: null,
            worldTransform: () => mockMatrix,
            boundingBox: () => undefined,
            dispose: () => {},
        } as IVisualObject;
        expect(isVisualGeometry(objectWithNullGeometry)).toBe(true);
    });

    test("should work with type narrowing", () => {
        const visualGeometry = new MockVisualGeometry();
        const visualObject = new MockVisualObject();

        if (isVisualGeometry(visualGeometry)) {
            // TypeScript should know this is IVisualGeometry
            expect(visualGeometry.geometryNode).toBe(mockGeometryNode);
        }

        if (isVisualGeometry(visualObject)) {
            // This should not execute
            expect(true).toBe(false);
        }
    });
});
