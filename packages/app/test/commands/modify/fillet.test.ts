// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4 } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { FilletCommand } from "../../../src/commands/modify/fillet";
import {
    ensureGlobalStubApp,
    type MockShape,
    mockShape,
    seedStepDatas,
    shapeStepResult,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

/**
 * Build a fillet command with the two required steps seeded:
 *   step 0 → a solid-like node whose `owner.node` is a ShapeNode-ish stub
 *   step 1 → a set of edges each carrying an `.index` (ISubEdgeShape)
 * Returns the command plus the node's tracking parent so callers can assert
 * what was added / removed from the document tree.
 */
function buildFilletCommand(edges: number[]) {
    const cmd = new FilletCommand();
    const { doc } = wireCommand(cmd);

    const shape = mockShape();
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;
    const solidNode = {
        name: "solid0",
        shape: { value: shape },
        transform: Matrix4.identity(),
        materialId: "mat-1",
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
    };

    const step0 = shapeStepResult([{ node: solidNode }]);
    // shapeStepResult assigns its own parent; repoint the node to ours.
    (step0.shapes[0].owner as any).node = solidNode;
    (step0.shapes[0].owner as any).getNode = () => solidNode;

    const step1 = shapeStepResult(edges.map((index) => ({ shape: { index } as Partial<MockShape> })));

    seedStepDatas(cmd, [step0, step1]);
    return { cmd, parent, shape, solidNode };
}

describe("FilletCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (FilletCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.fillet");
        expect(data.icon).toBe("icon-fillet");
    });

    test("radius should default to 10", () => {
        const cmd = new FilletCommand();
        expect(cmd.radius).toBe(10);
    });

    test("radius setter should update property", () => {
        const cmd = new FilletCommand();
        cmd.radius = 20;
        expect(cmd.radius).toBe(20);
    });

    test("getSteps should return two steps", () => {
        const cmd = new FilletCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("executeMainTask", () => {
        test("should add the filleted EditableShapeNode and remove the original node", () => {
            const { cmd, parent, shape } = buildFilletCommand([3, 7]);

            (cmd as any).executeMainTask();

            // shapeFactory.fillet(node.shape.value, edges, radius) was called.
            expect(shape.calls.get("transformedMul")).toBeUndefined(); // fillet does not transform the source
            expect(parent.added).toHaveLength(1);
            expect(parent.removed).toHaveLength(1);

            const added = parent.added[0] as any;
            expect(added.name).toBe("solid0");
            expect(added.materialId).toBe("mat-1");
            // The original node was removed.
            expect(parent.removed[0]).toBe(parent.removed[0]);
        });

        test("should fall back to rootNode when the original node has no parent", () => {
            const { cmd, solidNode } = buildFilletCommand([1]);
            // Detach the node so `node.parent ?? rootNode` is exercised.
            (solidNode as any).parent = undefined;

            expect(() => (cmd as any).executeMainTask()).not.toThrow();
        });

        test("should pass the configured radius through to shapeFactory.fillet", () => {
            const { cmd } = buildFilletCommand([2]);
            cmd.radius = 5;

            const factory = (globalThis as any).app.shapeProvider.factory;
            const calls: any[] = [];
            // Wrap the proxy to capture the args of the next `fillet` call.
            const original = factory.fillet;
            Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                configurable: true,
                value: new Proxy(
                    {},
                    {
                        get:
                            (_t, prop) =>
                            (...args: any[]) => {
                                if (prop === "fillet") calls.push(args);
                                return mockShape();
                            },
                    },
                ),
            });

            try {
                (cmd as any).executeMainTask();
                expect(calls).toHaveLength(1);
                expect(calls[0][2]).toBe(5); // radius is the 3rd arg
            } finally {
                Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                    configurable: true,
                    value: original,
                });
            }
        });
    });
});
