// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import v8 from "node:v8";
import vm from "node:vm";
import { ShapeTypes } from "@chili3d/core";
import { OccSubVertexShape, type OccVertex } from "../src/shape";
import { createBox, createTestFactory } from "./helpers";
import "./setup";

/**
 * A live embind handle answers; a deleted one makes every call throw
 * (`throwInstanceAlreadyDeleted`). Deleting is the only way a handle is freed — the bindings
 * register plain classes, so Emscripten attaches no finalizer of its own — which is what makes
 * this the observable form of "was the kernel object released".
 */
function isDeleted(handle: any): boolean {
    try {
        handle.shapeType();
        return false;
    } catch {
        return true;
    }
}

/** Only a collection can reach a finalizer, and V8 will not run one mid-test on its own. */
async function collect(): Promise<void> {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    gc();
    await new Promise((resolve) => setTimeout(resolve, 30));
    gc();
    await new Promise((resolve) => setTimeout(resolve, 30));
}

/** Its own frame, so nothing in the test still reaches the wrapper. */
function droppedWireHandle(shape: ReturnType<typeof createBox>): any {
    const face = shape.findSubShapes(ShapeTypes.face)[0];
    const wire = (face as any).outerWire();
    return wire.wire;
}

describe("kernel handle ownership", () => {
    test("disposing a wrapper deletes its handle", () => {
        const solid = createBox(createTestFactory()) as any;
        const handle = solid.shape;

        solid.dispose();

        expect(isDeleted(handle)).toBe(true);
    });

    test("a wrapper dropped without a dispose still gets its handle deleted", async () => {
        const handle = droppedWireHandle(createBox(createTestFactory()));

        await collect();

        expect(isDeleted(handle)).toBe(true);
    });

    test("a handle released by an explicit dispose is not deleted a second time", async () => {
        const solid = createBox(createTestFactory()) as any;
        const handle = solid.shape;
        solid.dispose();

        // A second delete throws out of the finalizer callback, where nothing can catch it —
        // the run fails on the unhandled error even though the assertions below hold.
        await collect();

        expect(isDeleted(handle)).toBe(true);
    });

    test("a wrapper that borrows another's handle leaves it to its owner", () => {
        const solid = createBox(createTestFactory());
        const vertex = solid.findSubShapes(ShapeTypes.vertex)[0] as OccVertex;
        const borrowed = new OccSubVertexShape({ parent: vertex, shape: vertex.vertex, index: 0 });

        borrowed.dispose();

        expect(isDeleted(vertex.shape)).toBe(false); // the parent still owns it
    });
});
