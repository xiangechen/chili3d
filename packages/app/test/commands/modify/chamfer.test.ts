// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4 } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { ChamferCommand } from "../../../src/commands/modify/chamfer";
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

function buildChamferCommand(edges: number[]) {
    const cmd = new ChamferCommand();
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
    (step0.shapes[0].owner as any).node = solidNode;
    (step0.shapes[0].owner as any).getNode = () => solidNode;

    const step1 = shapeStepResult(edges.map((index) => ({ shape: { index } as Partial<MockShape> })));

    seedStepDatas(cmd, [step0, step1]);
    return { cmd, parent, shape, solidNode };
}

describe("ChamferCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (ChamferCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.chamfer");
        expect(data.icon).toBe("icon-chamfer");
    });

    test("length should default to 10", () => {
        const cmd = new ChamferCommand();
        expect(cmd.length).toBe(10);
    });

    test("length setter should update property", () => {
        const cmd = new ChamferCommand();
        cmd.length = 20;
        expect(cmd.length).toBe(20);
    });

    test("getSteps should return two steps", () => {
        const cmd = new ChamferCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("executeMainTask", () => {
        test("should add the chamfered EditableShapeNode and remove the original node", () => {
            const { cmd, parent } = buildChamferCommand([3, 7]);

            (cmd as any).executeMainTask();

            expect(parent.added).toHaveLength(1);
            expect(parent.removed).toHaveLength(1);

            const added = parent.added[0] as any;
            expect(added.name).toBe("solid0");
            expect(added.materialId).toBe("mat-1");
        });

        test("should fall back to rootNode when the original node has no parent", () => {
            const { cmd, solidNode } = buildChamferCommand([1]);
            (solidNode as any).parent = undefined;

            expect(() => (cmd as any).executeMainTask()).not.toThrow();
        });

        test("should pass the configured length through to shapeFactory.chamfer", () => {
            const { cmd } = buildChamferCommand([2]);
            cmd.length = 8;

            const provider = (globalThis as any).app.shapeProvider;
            const original = provider.factory;
            const calls: any[] = [];
            Object.defineProperty(provider, "factory", {
                configurable: true,
                value: new Proxy(
                    {},
                    {
                        get:
                            (_t, prop) =>
                            (...args: any[]) => {
                                if (prop === "chamfer") calls.push(args);
                                return mockShape();
                            },
                    },
                ),
            });

            try {
                (cmd as any).executeMainTask();
                expect(calls).toHaveLength(1);
                expect(calls[0][2]).toBe(8); // length is the 3rd arg
            } finally {
                Object.defineProperty(provider, "factory", {
                    configurable: true,
                    value: original,
                });
            }
        });
    });
});
