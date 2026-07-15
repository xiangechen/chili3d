// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { getCurrentApplication, Plane, Result, ShapeTypes, setCurrentApplication, XYZ } from "@chili3d/core";

/**
 * Create a minimal mock IShape for testing body nodes.
 */
export function createMockShape() {
    return {
        shapeType: 0,
        isEqual: () => false,
        isClosed: () => false,
        mesh: { edges: undefined, faces: undefined, vertexs: undefined },
        matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        dispose: () => {},
    };
}

/**
 * Create a mock wire shape with enough API surface for ExtrudeNode / FaceNode tests.
 */
export function createMockWire() {
    return {
        shapeType: ShapeTypes.wire,
        isEqual: () => false,
        isClosed: () => false,
        mesh: { edges: undefined, faces: undefined, vertexs: undefined },
        matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        dispose: () => {},
        findSubShapes: () => [],
        orientation: () => "forward",
    };
}

/**
 * Create a mock edge suitable for use in FaceNode tests.
 */
export function createMockEdge(overrides: Record<string, any> = {}) {
    return {
        shapeType: ShapeTypes.edge,
        isEqual: () => false,
        isClosed: () => true,
        mesh: { edges: undefined, faces: undefined, vertexs: undefined },
        matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        dispose: () => {},
        ...overrides,
    };
}

/**
 * Create a mock wire IShape with edgeLoop support for PipeNode tests.
 */
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
    return {
        shapeType: ShapeTypes.wire,
        isEqual: () => false,
        isClosed: () => false,
        mesh: { edges: undefined, faces: undefined, vertexs: undefined },
        matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        dispose: () => {},
        edgeLoop: () => [mockEdge],
        findSubShapes: () => [],
    };
}

/**
 * Create a mock wire IShape that has toFace() for FacebaseNode tests.
 */
export function createMockWireShape() {
    return {
        ...createMockShape(),
        toFace: () => Result.ok(createMockShape()),
    };
}

export function defaultPlane() {
    return new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
}

function ensureApplicationForShapeFactory() {
    try {
        return getCurrentApplication();
    } catch {
        const stub = { shapeProvider: { factory: {}, converter: {} } } as any;
        setCurrentApplication(stub);
        return stub;
    }
}

/**
 * Mock shapeFactory methods on globalThis for the duration of a test.
 */
export function setupShapeFactoryMock(methods: Record<string, (...args: any[]) => any>) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");

    if (!desc) {
        Object.defineProperty(globalThis, "shapeFactory", {
            value: methods,
            writable: true,
            configurable: true,
        });
    } else if (desc.configurable && desc.writable !== false) {
        (globalThis as any).shapeFactory = methods;
    } else if (desc.configurable) {
        Object.defineProperty(globalThis, "shapeFactory", {
            value: methods,
            writable: true,
            configurable: true,
        });
    } else {
        const app = ensureApplicationForShapeFactory();
        if (app.shapeProvider?.factory) {
            Object.assign(app.shapeProvider.factory, methods);
        }
    }
}

/**
 * Setup shapeFactory with a single method returning Result.ok(createMockShape()).
 */
export function setupSimpleShapeFactoryMock(methodName: string) {
    const mockShape = createMockShape();
    setupShapeFactoryMock({
        [methodName]: () => Result.ok(mockShape),
    });
}
