// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { Sew } from "../../../src/commands/modify/sew";
import {
    ensureGlobalStubApp,
    makeParent,
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
 * Build a sew command whose two steps each carry one shape plus a node with a
 * real tracking parent, so `node.parent.remove(node)` is observable.
 */
function buildSewCommand() {
    const cmd = new Sew();
    const { doc } = wireCommand(cmd);

    const shape1 = mockShape();
    const shape2 = mockShape();
    const parent1 = makeParent({ id: "p1" });
    const parent2 = makeParent({ id: "p2" });
    const node1 = { parent: parent1, previousSibling: undefined, nextSibling: undefined };
    const node2 = { parent: parent2, previousSibling: undefined, nextSibling: undefined };

    const step0 = shapeStepResult([{ shape: shape1 as Partial<IShape>, node: node1 }]);
    const step1 = shapeStepResult([{ shape: shape2 as Partial<IShape>, node: node2 }]);
    // shapeStepResult doesn't expose a `nodes` slot, attach manually.
    (step0 as any).nodes = [node1];
    (step1 as any).nodes = [node2];

    seedStepDatas(cmd, [step0, step1]);

    const rootNode = doc.modelManager.rootNode as unknown as TrackingParent;
    return { cmd, rootNode, shape1, shape2, parent1, parent2, node1, node2 };
}

/** Override the global factory.sewing implementation; returns a restore fn. */
function overrideSewing(impl: (...args: any[]) => Result<any>): () => void {
    const provider = (globalThis as any).app.shapeProvider;
    const previous = provider.factory;
    const mock = new Proxy(
        {},
        {
            get: (_t, prop) => {
                if (prop === "sewing") return impl;
                return () => Result.ok(mockShape());
            },
        },
    );
    Object.defineProperty(provider, "factory", { configurable: true, value: mock });
    return () => Object.defineProperty(provider, "factory", { configurable: true, value: previous });
}

describe("Sew", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (Sew as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.sew");
        expect(data.icon).toBe("icon-sew");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Sew();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("executeMainTask", () => {
        test("should add a sewed EditableShapeNode to the root and remove both originals", () => {
            const { cmd, rootNode, parent1, parent2 } = buildSewCommand();

            (cmd as any).executeMainTask();

            // The sewed node lands on the document root.
            expect(rootNode.added).toHaveLength(1);
            expect((rootNode.added[0] as any).name).toBe("sewed");
            // Each source node was removed from its own parent.
            expect(parent1.removed).toHaveLength(1);
            expect(parent2.removed).toHaveLength(1);
        });

        test("should publish a toast and skip node creation when sewing fails", () => {
            let toastMessage: unknown;
            const originalPub = PubSub.default.pub;
            PubSub.default.pub = ((channel: string, ...args: unknown[]) => {
                if (channel === "showToast") toastMessage = args[1];
            }) as typeof PubSub.default.pub;

            const restore = overrideSewing(() => Result.err("sew failed"));
            try {
                const { cmd, rootNode, parent1 } = buildSewCommand();
                (cmd as any).executeMainTask();

                expect(toastMessage).toBe("sew failed");
                expect(rootNode.added).toHaveLength(0);
                expect(parent1.removed).toHaveLength(0);
            } finally {
                restore();
                PubSub.default.pub = originalPub;
            }
        });

        test("should forward both transformed shapes to shapeFactory.sewing", () => {
            const calls: any[] = [];
            const restore = overrideSewing((...args: any[]) => {
                calls.push(args);
                return Result.ok(mockShape());
            });
            try {
                const { cmd, shape1 } = buildSewCommand();
                (cmd as any).executeMainTask();

                expect(calls).toHaveLength(1);
                // First arg is the transformed first shape of step 0.
                expect(shape1.calls.get("transformedMul")).toHaveLength(1);
            } finally {
                restore();
            }
        });
    });

    describe("getSteps nodeFilter", () => {
        test("the first step should only allow ShapeNode instances", () => {
            const cmd = new Sew();
            const { doc } = wireCommand(cmd);
            const steps = (cmd as any).getSteps();
            const allow = steps[0].options.nodeFilter.allow;

            const shapeNode = new EditableShapeNode({
                document: doc,
                name: "n",
                shape: mockShape(),
            });
            expect(allow(shapeNode)).toBe(true);
            expect(allow({})).toBe(false);
        });

        test("the second step should reject non-ShapeNodes and already-selected shapes", () => {
            const cmd = new Sew();
            const { doc } = wireCommand(cmd);

            const firstShape = mockShape();
            const firstNode = new EditableShapeNode({
                document: doc,
                name: "first",
                shape: firstShape,
            });
            // Seed step 0 so the second filter can compare against its shapes.
            seedStepDatas(cmd, [{ nodes: [firstNode] } as any]);

            const steps = (cmd as any).getSteps();
            const allow = steps[1].options.nodeFilter.allow;

            // A plain object is rejected immediately.
            expect(allow({})).toBe(false);
            // A ShapeNode referencing the same shape as step 0 is rejected.
            const duplicateNode = new EditableShapeNode({
                document: doc,
                name: "dup",
                shape: firstShape,
            });
            expect(allow(duplicateNode)).toBe(false);
            // A ShapeNode with a distinct shape is allowed.
            const otherNode = new EditableShapeNode({
                document: doc,
                name: "other",
                shape: mockShape(),
            });
            expect(allow(otherNode)).toBe(true);
        });
    });
});
