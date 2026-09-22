// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockShape, setupShapeFactoryMock } from "@chili3d/core/test-utils";

// What the factory is mocked with is shared, and lives with the interface it mocks — the
// text module reads shapes from the same global, so its tests use the same two. This file
// keeps the fixtures a body node needs on top of them.
export { createMockShape, setupShapeFactoryMock };

/** A mock wire shape with enough API surface for ExtrudeNode / FaceNode tests. */
export function createMockWire() {
    return createMockShape({ shapeType: ShapeTypes.wire });
}

/** A mock edge suitable for use in FaceNode tests. */
export function createMockEdge(overrides: Record<string, any> = {}) {
    return createMockShape({ shapeType: ShapeTypes.edge, isClosed: () => true, ...overrides });
}

/** A mock wire IShape with edgeLoop support for PipeNode tests. */
export function createMockWireWithEdgeLoop() {
    const mockEdge = createMockEdge({
        curve: {
            firstParameter: () => 0,
            lastParameter: () => 1,
            value: (t: number) => new XYZ({ x: t, y: 0, z: 0 }),
            d1: (t: number) => ({
                point: new XYZ({ x: t, y: 0, z: 0 }),
                vec: {
                    x: 1,
                    y: 0,
                    z: 0,
                    normalize: () => XYZ.unitX,
                    cross: (_v: any) => new XYZ({ x: 0, y: 0, z: 0 }),
                    isParallelTo: () => true,
                },
            }),
        },
    });
    return Object.assign(createMockWire(), { edgeLoop: () => [mockEdge] });
}

/** A mock wire IShape that has toFace() for FacebaseNode tests. */
export function createMockWireShape() {
    return createMockShape({
        toFace: () => Result.ok(createMockShape()),
    });
}

export function defaultPlane() {
    return new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
}

/** Setup shapeFactory with a single method returning Result.ok(createMockShape()). */
export function setupSimpleShapeFactoryMock(methodName: string) {
    const mockShape = createMockShape();
    setupShapeFactoryMock({
        [methodName]: () => Result.ok(mockShape),
    });
}
