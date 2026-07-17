// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, Matrix4, PubSub, ShapeTypes } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { CopySubShapeCommand } from "../../../src/commands/create/copySubShape";
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

describe("CopySubShapeCommand", () => {
    test("should have command metadata", () => {
        const data = (CopySubShapeCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.copyShape");
        expect(data.icon).toBe("icon-subShape");
    });

    test("getSteps should return one step", () => {
        const cmd = new CopySubShapeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    describe("executeMainTask", () => {
        test("should clone each selected sub-shape and insertAfter the source node", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new CopySubShapeCommand();
                const { doc } = wireCommand(cmd);

                const parentA = makeParent({ id: "parent-a" });
                const parentB = makeParent({ id: "parent-b" });
                const nodeA = { parent: parentA, transform: Matrix4.identity() } as any;
                const nodeB = { parent: parentB, transform: Matrix4.identity() } as any;

                const cloneA = { shapeType: ShapeTypes.edge } as unknown as IShape;
                const cloneB = { shapeType: ShapeTypes.face } as unknown as IShape;

                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [
                            shapeData({
                                shape: { shapeType: ShapeTypes.edge, clone: () => cloneA },
                                node: nodeA,
                            }),
                            shapeData({
                                shape: { shapeType: ShapeTypes.face, clone: () => cloneB },
                                node: nodeB,
                            }),
                        ],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                expect(parentA.insertedAfter).toHaveLength(1);
                expect(parentA.insertedAfter[0].target).toBe(nodeA);
                const modelA = parentA.insertedAfter[0].node;
                expect(modelA).toBeInstanceOf(EditableShapeNode);
                // The node's shape comes from the clone.
                expect((modelA as any).shape.value).toBe(cloneA);

                expect(parentB.insertedAfter).toHaveLength(1);
                expect(parentB.insertedAfter[0].target).toBe(nodeB);
                expect(parentB.insertedAfter[0].node).toBeInstanceOf(EditableShapeNode);
                expect((parentB.insertedAfter[0].node as any).shape.value).toBe(cloneB);

                expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            } finally {
                restoreTx();
            }
        });

        test("should name the created node after the cloned shape's shapeType", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new CopySubShapeCommand();
                wireCommand(cmd);
                const node = { parent: makeParent(), transform: Matrix4.identity() } as any;
                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [
                            shapeData({
                                shape: {
                                    shapeType: ShapeTypes.edge,
                                    clone: () => ({ shapeType: ShapeTypes.edge }) as unknown as IShape,
                                },
                                node,
                            }),
                        ],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                const model = (node.parent as any).insertedAfter[0].node;
                expect(model.name).toBe("Edge");
            } finally {
                restoreTx();
            }
        });

        test("should copy the source node transform onto the created model", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new CopySubShapeCommand();
                wireCommand(cmd);
                const tx = Matrix4.fromTranslation(2, 3, 4);
                const node = { parent: makeParent(), transform: tx } as any;
                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [
                            shapeData({
                                shape: {
                                    shapeType: ShapeTypes.face,
                                    clone: () => ({ shapeType: ShapeTypes.face }) as unknown as IShape,
                                },
                                node,
                            }),
                        ],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                const model = (node.parent as any).insertedAfter[0].node;
                expect(model.transform).toBe(tx);
            } finally {
                restoreTx();
            }
        });

        test("should publish the success toast after copying", () => {
            const restoreTx = stubTransactionRun();
            const published: unknown[][] = [];
            const origPub = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);
            try {
                const cmd = new CopySubShapeCommand();
                wireCommand(cmd);
                const node = { parent: makeParent(), transform: Matrix4.identity() } as any;
                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [
                            shapeData({
                                shape: {
                                    shapeType: ShapeTypes.edge,
                                    clone: () => ({ shapeType: ShapeTypes.edge }) as unknown as IShape,
                                },
                                node,
                            }),
                        ],
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

        test("should handle an empty selection without inserting anything", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new CopySubShapeCommand();
                wireCommand(cmd);
                seedStepDatas(cmd, [{ type: "shape" as const, shapes: [] } as any]);

                expect(() => (cmd as any).executeMainTask()).not.toThrow();
            } finally {
                restoreTx();
            }
        });
    });
});
