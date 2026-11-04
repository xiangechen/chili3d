// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    getCurrentApplication,
    type IShapeMeshData,
    Plane,
    Result,
    ShapeTypes,
    setCurrentApplication,
    XYZ,
} from "@chili3d/core";
import { MockShape } from "@chili3d/core/test-utils";
import { onTestFinished } from "@rstest/core";

/**
 * MockShape variant that preserves the minimal behavior the body-node tests rely on:
 * - `isEqual` always returns false, so `ShapeNode.setShape` never skips an update
 *   (the shared MockShape uses identity comparison, which would suppress updates when
 *   a factory mock returns the same instance twice).
 * - `mesh` fields stay undefined instead of the shared rich mesh data.
 */
class BodyMockShape extends MockShape {
    override get mesh(): IShapeMeshData {
        return { edges: undefined, faces: undefined, vertexs: undefined };
    }

    override isEqual(): boolean {
        return false;
    }

    override isClosed(): boolean {
        return false;
    }
}

/**
 * Create a minimal mock IShape for testing body nodes.
 */
export function createMockShape(overrides: Record<string, unknown> = {}) {
    return Object.assign(new BodyMockShape({ shapeType: ShapeTypes.shape }), overrides);
}

/**
 * Create a mock wire shape with enough API surface for ExtrudeNode / FaceNode tests.
 */
export function createMockWire() {
    return new BodyMockShape({ shapeType: ShapeTypes.wire });
}

/**
 * Create a mock edge suitable for use in FaceNode tests.
 */
export function createMockEdge(overrides: Record<string, any> = {}) {
    return createMockShape({ shapeType: ShapeTypes.edge, isClosed: () => true, ...overrides });
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
    return Object.assign(createMockWire(), { edgeLoop: () => [mockEdge] });
}

/**
 * Create a mock wire IShape that has toFace() for FacebaseNode tests.
 */
export function createMockWireShape() {
    return createMockShape({
        toFace: () => Result.ok(createMockShape()),
    });
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
 * The previous state is restored automatically when the test finishes.
 */
export function setupShapeFactoryMock(methods: Record<string, (...args: any[]) => any>) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");

    if (!desc) {
        Object.defineProperty(globalThis, "shapeFactory", {
            value: methods,
            writable: true,
            configurable: true,
        });
        onTestFinished(() => {
            delete (globalThis as any).shapeFactory;
        });
    } else if (desc.writable === true) {
        // A real writable data property — direct assignment is enough.
        const previous = (globalThis as any).shapeFactory;
        (globalThis as any).shapeFactory = methods;
        onTestFinished(() => {
            (globalThis as any).shapeFactory = previous;
        });
    } else {
        // Accessor-only getter (with or without a setter). Rather than redefine
        // the global and lose the app-backed getter, merge the methods into the
        // underlying factory object so the getter keeps resolving correctly.
        const app = ensureApplicationForShapeFactory();
        const factory = app.shapeProvider?.factory;
        if (factory) {
            const previous: Record<string, unknown> = {};
            for (const key of Object.keys(methods)) {
                previous[key] = factory[key];
            }
            Object.assign(factory, methods);
            onTestFinished(() => {
                for (const key of Object.keys(methods)) {
                    if (previous[key] === undefined) {
                        delete factory[key];
                    } else {
                        factory[key] = previous[key];
                    }
                }
            });
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
