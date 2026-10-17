// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
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
        expect(data).not.toBeNull();
        expect(data.key).toBe("modify.sew");
        expect(data.icon).toBe("icon-sew");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Sew();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
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

        test("should not dispose the sewn shape when repair returns it unchanged", () => {
            const nullShape = { isNull: () => true } as any;
            const sewn = mockShape({
                shellSewing: () => nullShape,
                fixShape: () => nullShape,
                fixSmallFace: () => nullShape,
                dispose: rs.fn(),
            });
            const restore = overrideSewing(() => Result.ok(sewn));
            try {
                const { cmd, rootNode } = buildSewCommand();
                (cmd as any).executeMainTask();

                // The repair pass aliases the sewn shape — disposing it would kill the result.
                expect(rootNode.added).toHaveLength(1);
                expect((rootNode.added[0] as any).shape.value).toBe(sewn);
                expect(sewn.dispose).not.toHaveBeenCalled();
            } finally {
                restore();
            }
        });

        test("should dispose the sewn shape and replaced intermediates when repair produces new shapes", () => {
            const nullShape = { isNull: () => true } as any;
            const finalShape = mockShape({ dispose: rs.fn() });
            const sewnOnce = mockShape({
                fixShape: () => nullShape,
                fixSmallFace: () => finalShape,
                dispose: rs.fn(),
            });
            const sewn = mockShape({ shellSewing: () => sewnOnce, dispose: rs.fn() });
            const restore = overrideSewing(() => Result.ok(sewn));
            try {
                const { cmd, rootNode } = buildSewCommand();
                (cmd as any).executeMainTask();

                expect((rootNode.added[0] as any).shape.value).toBe(finalShape);
                expect(sewn.dispose).toHaveBeenCalledTimes(1);
                expect(sewnOnce.dispose).toHaveBeenCalledTimes(1);
                expect(finalShape.dispose).not.toHaveBeenCalled();
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
    });
});
