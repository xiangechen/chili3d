// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, Matrix4, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { ThickSolidCommand } from "../../../src/commands/create/thickSolid";
import {
    ensureGlobalStubApp,
    makeParent,
    seedStepDatas,
    shapeData,
    stubTransactionRun,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("ThickSolidCommand", () => {
    test("should have command metadata", () => {
        const data = (ThickSolidCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.thickSolid");
        expect(data.icon).toBe("icon-thickSolid");
    });

    test("thickness should default to 10", () => {
        const cmd = new ThickSolidCommand();
        expect(cmd.thickness).toBe(10);
    });

    test("thickness setter should update property", () => {
        const cmd = new ThickSolidCommand();
        cmd.thickness = 20;
        expect(cmd.thickness).toBe(20);
    });

    test("getSteps should return one step", () => {
        const cmd = new ThickSolidCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    describe("executeMainTask", () => {
        test("should create one EditableShapeNode per selected face and insertAfter each source node", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ThickSolidCommand();
                const { doc } = wireCommand(cmd);

                const parentA = makeParent({ id: "parent-a" });
                const parentB = makeParent({ id: "parent-b" });
                const nodeA = { parent: parentA, transform: Matrix4.identity() } as any;
                const nodeB = { parent: parentB, transform: Matrix4.identity() } as any;

                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [
                            shapeData({ shape: { shapeType: ShapeTypes.face }, node: nodeA }),
                            shapeData({ shape: { shapeType: ShapeTypes.face }, node: nodeB }),
                        ],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                expect(parentA.insertedAfter).toHaveLength(1);
                expect(parentA.insertedAfter[0].target).toBe(nodeA);
                expect(parentA.insertedAfter[0].node).toBeInstanceOf(EditableShapeNode);
                expect(parentB.insertedAfter).toHaveLength(1);
                expect(parentB.insertedAfter[0].target).toBe(nodeB);
                expect(parentB.insertedAfter[0].node).toBeInstanceOf(EditableShapeNode);
                expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            } finally {
                restoreTx();
            }
        });

        test("should propagate the configured thickness to makeThickSolidBySimple", () => {
            const restoreTx = stubTransactionRun();
            const stubApp = (globalThis as any).app;
            const originalFactory = stubApp.shapeProvider.factory;
            const received: number[] = [];
            stubApp.shapeProvider.factory = {
                makeThickSolidBySimple: (_shape: unknown, thickness: number) => {
                    received.push(thickness);
                    return Result.ok({
                        shapeType: ShapeTypes.solid,
                        mesh: { edges: { position: new Float32Array() } },
                    } as any);
                },
            };
            try {
                const cmd = new ThickSolidCommand();
                cmd.thickness = 7;
                wireCommand(cmd);
                const node = { parent: makeParent(), transform: Matrix4.identity() } as any;
                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [shapeData({ shape: { shapeType: ShapeTypes.face }, node })],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                expect(received).toEqual([7]);
            } finally {
                stubApp.shapeProvider.factory = originalFactory;
                restoreTx();
            }
        });

        test("should copy the source node transform onto the created model", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ThickSolidCommand();
                wireCommand(cmd);
                const tx = Matrix4.fromTranslation(3, 4, 5);
                const node = { parent: makeParent(), transform: tx } as any;
                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [shapeData({ shape: { shapeType: ShapeTypes.face }, node })],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                const model = (node.parent as any).insertedAfter[0].node;
                // transform should be the same matrix object reference as the source node.
                expect(model.transform).toBe(tx);
            } finally {
                restoreTx();
            }
        });

        test("should publish an error toast and skip shapes whose thick-solid result is an error", () => {
            const restoreTx = stubTransactionRun();
            const stubApp = (globalThis as any).app;
            const originalFactory = stubApp.shapeProvider.factory;
            stubApp.shapeProvider.factory = {
                makeThickSolidBySimple: () => Result.err("thick failed"),
            };
            const published: unknown[][] = [];
            const origPub = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);
            try {
                const cmd = new ThickSolidCommand();
                wireCommand(cmd);
                const parent = makeParent();
                const node = { parent, transform: Matrix4.identity() } as any;
                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [shapeData({ shape: { shapeType: ShapeTypes.face }, node })],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                // No node inserted for the failing shape.
                expect(parent.insertedAfter).toHaveLength(0);
                // PubSub publishes ("showToast", <message>); collect the messages.
                const messages = published.filter((p) => p[0] === "showToast").map((p) => p[1]);
                expect(messages).toContain("toast.converter.error");
                expect(messages).toContain("toast.success");
            } finally {
                PubSub.default.pub = origPub;
                stubApp.shapeProvider.factory = originalFactory;
                restoreTx();
            }
        });

        test("should publish the success toast on the happy path", () => {
            const restoreTx = stubTransactionRun();
            const published: unknown[][] = [];
            const origPub = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);
            try {
                const cmd = new ThickSolidCommand();
                wireCommand(cmd);
                const node = { parent: makeParent(), transform: Matrix4.identity() } as any;
                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [shapeData({ shape: { shapeType: ShapeTypes.face }, node })],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                const messages = published.filter((p) => p[0] === "showToast").map((p) => p[1]);
                expect(messages).toContain("toast.success");
            } finally {
                PubSub.default.pub = origPub;
                restoreTx();
            }
        });
    });
});
