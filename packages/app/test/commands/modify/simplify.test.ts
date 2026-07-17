// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, Result } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { SimplifyShapeCommand } from "../../../src/commands/modify/simplify";
import {
    ensureGlobalStubApp,
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

function buildSimplifyCommand() {
    const cmd = new SimplifyShapeCommand();
    const { doc } = wireCommand(cmd);

    const shape = mockShape();
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;
    const node = {
        name: "shell0",
        shape: { value: shape },
        transform: Matrix4.identity(),
        materialId: "mat-1",
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
    };

    const step0 = shapeStepResult([{ node }]);
    (step0.shapes[0].owner as any).node = node;
    (step0.shapes[0].owner as any).getNode = () => node;

    seedStepDatas(cmd, [step0]);
    return { cmd, parent, node, shape };
}

/** Swap the global factory's simplifyShape implementation; returns a restore fn. */
function overrideSimplify(impl: (...args: any[]) => Result<any>): () => void {
    const provider = (globalThis as any).app.shapeProvider;
    const previous = provider.factory;
    const mock = new Proxy(
        {},
        {
            get: (_t, prop) => {
                if (prop === "simplifyShape") return impl;
                return () => Result.ok(mockShape());
            },
        },
    );
    Object.defineProperty(provider, "factory", { configurable: true, value: mock });
    return () => Object.defineProperty(provider, "factory", { configurable: true, value: previous });
}

describe("SimplifyShapeCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (SimplifyShapeCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.simplifyShape");
        expect(data.icon).toBe("icon-simplify");
    });

    test("removeEdges should default to true", () => {
        const cmd = new SimplifyShapeCommand();
        expect(cmd.removeEdges).toBe(true);
    });

    test("removeEdges setter should update property", () => {
        const cmd = new SimplifyShapeCommand();
        cmd.removeEdges = false;
        expect(cmd.removeEdges).toBe(false);
    });

    test("removeFaces should default to true", () => {
        const cmd = new SimplifyShapeCommand();
        expect(cmd.removeFaces).toBe(true);
    });

    test("removeFaces setter should update property", () => {
        const cmd = new SimplifyShapeCommand();
        cmd.removeFaces = false;
        expect(cmd.removeFaces).toBe(false);
    });

    test("getSteps should return one step", () => {
        const cmd = new SimplifyShapeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    describe("executeMainTask", () => {
        test("should add a simplified EditableShapeNode and remove the original", () => {
            const { cmd, parent } = buildSimplifyCommand();

            (cmd as any).executeMainTask();

            expect(parent.added).toHaveLength(1);
            expect(parent.removed).toHaveLength(1);
            expect((parent.added[0] as any).name).toBe("shell0_simplified");
            expect((parent.added[0] as any).materialId).toBe("mat-1");
        });

        test("should throw when simplifyShape returns an error result", () => {
            const restore = overrideSimplify(() => Result.err("sim failed"));
            try {
                const { cmd } = buildSimplifyCommand();
                expect(() => (cmd as any).executeMainTask()).toThrow("sim failed");
            } finally {
                restore();
            }
        });

        test("should forward removeEdges / removeFaces to shapeFactory.simplifyShape", () => {
            const calls: any[] = [];
            const restore = overrideSimplify((...args: any[]) => {
                calls.push(args);
                return Result.ok(mockShape());
            });
            try {
                const { cmd } = buildSimplifyCommand();
                cmd.removeEdges = false;
                cmd.removeFaces = false;

                (cmd as any).executeMainTask();

                expect(calls).toHaveLength(1);
                // [shape, removeEdges, removeFaces, []]
                expect(calls[0][1]).toBe(false);
                expect(calls[0][2]).toBe(false);
            } finally {
                restore();
            }
        });
    });
});
