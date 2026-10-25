// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IShapeProvider, Matrix4, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { ShellCommand } from "../../../src/commands/modify/shell";
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

/**
 * Build a shell command with the two required steps seeded:
 *   step 0 → a solid-like node whose `owner.node` is a ShapeNode-ish stub
 *   step 1 → the open faces to remove (each entry becomes one IFace)
 * Returns the command plus the node's tracking parent so callers can assert
 * what was added / removed from the document tree.
 */
function buildShellCommand(faceCount = 2) {
    const cmd = new ShellCommand();
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

    const faces = Array.from({ length: faceCount }, (_, index) => mockShape({ id: `face-${index}` }) as any);
    const step1 = shapeStepResult(faces.map((shape) => ({ shape })));

    seedStepDatas(cmd, [step0, step1]);
    return { cmd, parent, shape, solidNode, faces, doc };
}

/**
 * Stub `shapeProvider.factory`: `makeThickSolidByJoin` is handled by the given
 * callback, every other factory method returns a plain mock shape.
 * Returns a restore function — call it in `finally`.
 */
function stubShapeFactory(onMakeThickSolidByJoin: (args: any[]) => unknown): () => void {
    const provider = (globalThis as any).app.shapeProvider as IShapeProvider;
    const original = provider.factory;
    Object.defineProperty(provider, "factory", {
        configurable: true,
        value: new Proxy(
            {},
            {
                get:
                    (_t, prop) =>
                    (...args: any[]) =>
                        prop === "makeThickSolidByJoin" ? onMakeThickSolidByJoin(args) : mockShape(),
            },
        ),
    });
    return () => {
        Object.defineProperty(provider, "factory", { configurable: true, value: original });
    };
}

/** Make the mock selection report the given faces as the currently selected shapes. */
function stubSelectedFaces(doc: IDocument, faces: any[]): void {
    (doc.selection as any).getSelectedShapes = () => faces.map((f) => ({ shape: f }));
}

describe("ShellCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (ShellCommand as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("modify.shell");
        expect(data.icon).toBe("icon-shell");
    });

    test("thickness should default to 1", () => {
        const cmd = new ShellCommand();
        expect(cmd.thickness).toBe(1);
    });

    test("thickness setter should update property", () => {
        const cmd = new ShellCommand();
        wireCommand(cmd);
        cmd.thickness = 5;
        expect(cmd.thickness).toBe(5);
    });

    test("getSteps should return two steps", () => {
        const cmd = new ShellCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    test("first step shape filter should only allow solid-like shapes", () => {
        const cmd = new ShellCommand();
        const steps = (cmd as any).getSteps();
        const allow = steps[0].options.shapeFilter.allow;
        expect(allow({ shapeType: ShapeTypes.solid })).toBe(true);
        expect(allow({ shapeType: ShapeTypes.compound })).toBe(true);
        expect(allow({ shapeType: ShapeTypes.compoundSolid })).toBe(true);
        expect(allow({ shapeType: ShapeTypes.face })).toBe(false);
        expect(allow({ shapeType: ShapeTypes.edge })).toBe(false);
    });

    describe("executeMainTask", () => {
        test("should add the shelled EditableShapeNode and remove the original node", () => {
            const { cmd, parent, doc } = buildShellCommand();

            (cmd as any).executeMainTask();

            expect(parent.added).toHaveLength(1);
            expect(parent.removed).toHaveLength(1);
            expect(parent.removed[0]).toBe((cmd as any).stepDatas[0].shapes[0].owner.node);

            const added = parent.added[0] as any;
            expect(added.name).toBe("solid0");
            expect(added.materialId).toBe("mat-1");
            expect(doc.visual.update).toHaveBeenCalled();
        });

        test("should fall back to rootNode when the original node has no parent", () => {
            const { cmd, solidNode, parent } = buildShellCommand(1);
            // Detach the node so `node.parent ?? rootNode` is exercised.
            (solidNode as any).parent = undefined;

            (cmd as any).executeMainTask();

            expect(parent.added).toHaveLength(1);
        });

        test("should pass the selected faces and thickness to shapeFactory.makeThickSolidByJoin", () => {
            const { cmd, shape } = buildShellCommand(3);
            cmd.thickness = 2.5;

            const calls: any[] = [];
            const restoreFactory = stubShapeFactory((args) => {
                calls.push(args);
                return mockShape();
            });

            try {
                (cmd as any).executeMainTask();
                expect(calls).toHaveLength(1);
                expect(calls[0][0]).toBe(shape); // the original solid
                expect(calls[0][1]).toHaveLength(3); // the selected open faces
                // Negative carves inward: that is what a shell means, and the kernel's sign.
                expect(calls[0][2]).toBe(-2.5);
                expect(calls[0][3]).toBe("arc"); // joinType is the 4th arg
                // The dead offset-mode / intersection arguments are no longer passed.
                expect(calls[0][4]).toBeUndefined();
                expect(calls[0][5]).toBeUndefined();
                expect(calls[0][1].map((x: any) => x.id)).toEqual(["face-0", "face-1", "face-2"]);
            } finally {
                restoreFactory();
            }
        });

        test("outward stands the wall outside the body instead of carving it out", () => {
            const { cmd } = buildShellCommand(2);
            cmd.thickness = 2.5;
            cmd.outward = true;

            const calls: any[] = [];
            const restoreFactory = stubShapeFactory((args) => {
                calls.push(args);
                return mockShape();
            });

            try {
                (cmd as any).executeMainTask();
                expect(calls).toHaveLength(1);
                expect(calls[0][2]).toBe(2.5);
            } finally {
                restoreFactory();
            }
        });

        test("should refuse a thickness that is not positive", () => {
            const { cmd, parent } = buildShellCommand(2);
            cmd.thickness = 0;
            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});

            try {
                (cmd as any).executeMainTask();
                expect(parent.added).toHaveLength(0);
                expect(pubSpy).toHaveBeenCalledWith("showToast", "error.default:{0}", "Invalid thickness");
            } finally {
                pubSpy.mockRestore();
            }
        });

        test("should not modify the document when the shell operation fails", () => {
            const { cmd, parent, doc } = buildShellCommand();

            const restoreFactory = stubShapeFactory(() => Result.err("shell failed"));

            try {
                (cmd as any).executeMainTask();
                expect(parent.added).toHaveLength(0);
                expect(parent.removed).toHaveLength(0);
                expect(doc.visual.update).not.toHaveBeenCalled();
            } finally {
                restoreFactory();
            }
        });
    });

    describe("onOpenFacesChanged (debounced preview)", () => {
        test("second step should subscribe and unsubscribe the preview handler", () => {
            const { cmd, doc } = buildShellCommand(1);
            const steps = (cmd as any).getSteps();
            const options = steps[1].options;

            options.beforeSelection();
            expect(doc.selection.onShapeChanged.sub).toHaveBeenCalledWith((cmd as any).onOpenFacesChanged);

            options.afterSelection();
            expect(doc.selection.onShapeChanged.remove).toHaveBeenCalledWith((cmd as any).onOpenFacesChanged);
        });

        test("should show a debounced preview with the selected open faces", () => {
            rs.useFakeTimers();
            const { cmd, shape, faces, doc } = buildShellCommand(2);

            const calls: any[] = [];
            const previewShape = mockShape({ mesh: { faces: {}, edges: {} } as any });
            const restoreFactory = stubShapeFactory((args) => {
                calls.push(args);
                return Result.ok(previewShape);
            });

            try {
                // The handler ignores event args and reads the selection itself
                stubSelectedFaces(doc, faces);
                (cmd as any).onOpenFacesChanged();

                // Debounced: the factory is not called before the delay elapses
                expect(calls).toHaveLength(0);
                rs.advanceTimersByTime(25);

                expect(calls).toHaveLength(1);
                expect(calls[0][0]).toBe(shape); // the original solid
                expect(calls[0][1].map((x: any) => x.id)).toEqual(["face-0", "face-1"]);
                // The kernel runs in the body's local space; the preview is placed in the
                // world by the picked body's transform.
                const bodyTransform = (cmd as any).stepDatas[0].shapes[0].transform;
                expect(previewShape.calls.get("transformedMul")?.[0]?.[0]).toBe(bodyTransform);
                // the result is previewed; the original stays visible through the pick
                expect(doc.visual.context.displayMesh).toHaveBeenCalled();
                expect(doc.visual.update).toHaveBeenCalled();
            } finally {
                restoreFactory();
                rs.useRealTimers();
            }
        });

        test("should show no preview when the selection is cleared", () => {
            rs.useFakeTimers();
            try {
                const { cmd, doc } = buildShellCommand(1);

                (cmd as any).onOpenFacesChanged();
                rs.advanceTimersByTime(25);

                expect(doc.visual.context.displayMesh).not.toHaveBeenCalled();
            } finally {
                rs.useRealTimers();
            }
        });

        test("should show nothing and publish no toast when the preview fails", () => {
            rs.useFakeTimers();
            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            const { cmd, faces, doc } = buildShellCommand(1);

            const restoreFactory = stubShapeFactory(() => Result.err("shell failed"));

            try {
                stubSelectedFaces(doc, faces);
                (cmd as any).onOpenFacesChanged();
                rs.advanceTimersByTime(25);

                expect(doc.visual.context.displayMesh).not.toHaveBeenCalled();
                expect(pubSpy).not.toHaveBeenCalledWith("showToast", "error.default:{0}", "shell failed");
            } finally {
                restoreFactory();
                pubSpy.mockRestore();
                rs.useRealTimers();
            }
        });
    });
});
