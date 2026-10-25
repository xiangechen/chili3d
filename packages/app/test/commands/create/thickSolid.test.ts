// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, Matrix4, PubSub, Result, ShapeTypes, VisualStates } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { ThickSolidCommand } from "../../../src/commands/create/thickSolid";
import {
    ensureGlobalStubApp,
    makeParent,
    mockShape,
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
        expect(data).not.toBeNull();
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

    describe("direction options", () => {
        function thickenArgs(configure: (cmd: ThickSolidCommand) => void): number[] {
            const stubApp = (globalThis as any).app;
            const originalFactory = stubApp.shapeProvider.factory;
            const received: number[] = [];
            const solid = { dispose: () => {} };
            stubApp.shapeProvider.factory = {
                makeThickSolidBySimple: (_shape: unknown, thickness: number) => {
                    received.push(thickness);
                    return Result.ok(solid);
                },
                combine: (shapes: unknown[]) => Result.ok(shapes[0]),
            };
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ThickSolidCommand();
                configure(cmd);
                wireCommand(cmd);
                const node = { parent: makeParent(), transform: Matrix4.identity() } as any;
                seedStepDatas(cmd, [
                    {
                        type: "shape" as const,
                        shapes: [shapeData({ shape: { shapeType: ShapeTypes.face }, node })],
                    } as any,
                ]);
                (cmd as any).executeMainTask();
                return received;
            } finally {
                restoreTx();
                stubApp.shapeProvider.factory = originalFactory;
            }
        }

        test("midplane splits the thickness across both sides", () => {
            expect(
                thickenArgs((cmd) => {
                    cmd.thickness = 8;
                    cmd.midplane = true;
                }),
            ).toEqual([4, -4]);
        });

        test("oppositeDirection flips which side the material goes", () => {
            expect(
                thickenArgs((cmd) => {
                    cmd.thickness = 3;
                    cmd.oppositeDirection = true;
                }),
            ).toEqual([-3]);
        });

        test("thickness2 adds a second, opposite direction", () => {
            expect(
                thickenArgs((cmd) => {
                    cmd.thickness = 3;
                    cmd.thickness2 = 5;
                }),
            ).toEqual([3, -5]);
        });

        test("midplane ignores a negative thickness2 while its row is hidden", () => {
            expect(
                thickenArgs((cmd) => {
                    cmd.thickness = 6;
                    cmd.midplane = true;
                    cmd.thickness2 = -4;
                }),
            ).toEqual([3, -3]);
        });
    });

    test("thickens the node's own local shape, without copying it into world space", () => {
        const stubApp = (globalThis as any).app;
        const originalFactory = stubApp.shapeProvider.factory;
        const calls: unknown[][] = [];
        const solid = { dispose: () => {} };
        stubApp.shapeProvider.factory = {
            makeThickSolidBySimple: (...args: unknown[]) => {
                calls.push(args);
                return Result.ok(solid);
            },
            combine: (shapes: unknown[]) => Result.ok(shapes[0]),
        };
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ThickSolidCommand();
            wireCommand(cmd);
            const parent = makeParent();
            const node = { parent, transform: Matrix4.fromTranslation(3, 4, 5) } as any;
            const data = shapeData({ shape: { shapeType: ShapeTypes.face }, node });
            seedStepDatas(cmd, [{ type: "shape" as const, shapes: [data] } as any]);

            (cmd as any).executeMainTask();

            // The kernel gets the node's own face — no world-space copy.
            expect(calls[0][0]).toBe(data.shape);
            expect((data.shape as any).calls.get("transformedMul")).toBeUndefined();
            // ...and the transform is carried by the new node, once.
            expect((parent.insertedAfter[0].node as any).transform).toBe(node.transform);
        } finally {
            restoreTx();
            stubApp.shapeProvider.factory = originalFactory;
        }
    });

    test("the face pick keeps to the live selection's body", () => {
        const cmd = new ThickSolidCommand();
        const { doc } = wireCommand(cmd);
        const nodeA = {};
        const nodeB = {};
        (doc.selection as any).getSelectedShapes = () => [
            { shape: { shapeType: ShapeTypes.face }, owner: { node: nodeA } },
        ];

        const allow = (cmd as any).getSteps()[0].options.nodeFilter.allow;
        expect(allow(nodeA)).toBe(true);
        expect(allow(nodeB)).toBe(false);
    });

    describe("preview", () => {
        test("a live pick shows the thickened solid over the ghosted body", () => {
            const stubApp = (globalThis as any).app;
            const originalFactory = stubApp.shapeProvider.factory;
            const solid = {
                mesh: { faces: {}, edges: {} },
                transformedMul: () => solid,
                dispose: () => {},
            };
            stubApp.shapeProvider.factory = {
                makeThickSolidBySimple: () => Result.ok(solid),
                combine: () => Result.ok(solid),
            };
            try {
                const cmd = new ThickSolidCommand();
                const { doc } = wireCommand(cmd);
                const face = mockShape({ shapeType: ShapeTypes.face });
                (doc.selection as any).getSelectedShapes = () => [
                    { shape: face, transform: Matrix4.identity(), owner: { node: {} } },
                ];

                (cmd as any).previewActive = true;
                (cmd as any).updatePreview();

                expect(doc.visual.context.displayMesh).toHaveBeenCalled();
                expect(doc.visual.highlighter.addState).toHaveBeenCalledWith(
                    expect.anything(),
                    VisualStates.faceTransparent,
                    ShapeTypes.shape,
                );
            } finally {
                stubApp.shapeProvider.factory = originalFactory;
            }
        });

        test("a thickness that cannot be built shows nothing", () => {
            const cmd = new ThickSolidCommand();
            const { doc } = wireCommand(cmd);
            (doc.selection as any).getSelectedShapes = () => [];

            (cmd as any).previewActive = true;
            (cmd as any).updatePreview();

            expect(doc.visual.context.displayMesh).not.toHaveBeenCalled();
        });
    });

    describe("executeMainTask", () => {
        test("should build one combined solid and insert it after the picked faces' node", () => {
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
                // One result covers the whole pick; the second node adds nothing.
                expect(parentB.insertedAfter).toHaveLength(0);
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
                        dispose: () => {},
                    } as any);
                },
                combine: (shapes: unknown[]) => Result.ok(shapes[0]),
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

                // The whole result failed, so nothing is inserted and no success is claimed.
                expect(parent.insertedAfter).toHaveLength(0);
                const messages = published.filter((p) => p[0] === "showToast").map((p) => p[1]);
                expect(messages).toContain("toast.converter.error");
                expect(messages).not.toContain("toast.success");
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
