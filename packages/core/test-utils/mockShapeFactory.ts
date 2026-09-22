// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { onTestFinished } from "@rstest/core";
import { getCurrentApplication, type IShapeMeshData, ShapeTypes, setCurrentApplication } from "../src";
import { MockShape } from "./mockShape";

/**
 * What a mocked factory hands back, and a shape the tests that read one rely on:
 * - `isEqual` always returns false, so `ShapeNode.setShape` never skips an update
 *   (the shared MockShape uses identity comparison, which would suppress updates when
 *   a factory mock returns the same instance twice).
 * - `mesh` fields stay undefined instead of the shared rich mesh data.
 */
class FactoryShape extends MockShape {
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

/** A minimal mock IShape, for a test that needs something a factory can return. */
export function createMockShape(overrides: Record<string, unknown> = {}) {
    return Object.assign(new FactoryShape({ shapeType: ShapeTypes.shape }), overrides);
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
 *
 * The factory is a global that the wasm package installs at startup, so what a test has to
 * reach for depends on how far the application has been built: nothing at all, a writable
 * value, or the getter alone. All three are put back the way they were.
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
