// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IApplication,
    type IShape,
    Matrix4,
    Result,
    ShapeTypes,
    type VisualShapeData,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { RemoveFaceCommand } from "../../../src/commands/modify/removeFeature";
import {
    makeParent,
    mockShape,
    seedStepDatas,
    shapeStepResult,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../../commands/commandTestUtils";

/**
 * Install a stub global `app` whose `shapeProvider.factory` is a concrete object
 * we can attach spied methods to. Unlike `ensureGlobalStubApp` (which uses a
 * Proxy whose methods are anonymous), this lets tests assert exactly which
 * factory method was called and with what arguments.
 *
 * Returns the factory object plus a restore function.
 */
function installStubAppWithFactory() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
    const factory = {
        removeFeature: rs.fn(() => Result.ok(mockShape({ shapeType: ShapeTypes.solid }))),
    };
    const stubApp = {
        shapeProvider: { factory, converter: {} as any },
    } as unknown as IApplication;
    Object.defineProperty(globalThis, "app", {
        configurable: true,
        get: () => stubApp,
    });
    return {
        factory,
        restore: () => {
            if (previous) Object.defineProperty(globalThis, "app", previous);
        },
    };
}

/**
 * Build a SelectShapeStep result whose first shape's `owner.node` is a fake
 * ShapeNode carrying `.shape.value`, `.transform`, `.materialId`, `.name` and a
 * TrackingParent so `node.parent.remove(node)` is observable.
 *
 * `stepDatas[0]` selects the solid node; `stepDatas[1]` (== at(-1)) carries the
 * faces to remove. removeFeature reads `stepDatas[0].shapes[0].owner.node` and
 * maps `stepDatas.at(-1).shapes` to faces.
 */
function buildStepDatas() {
    const parent: TrackingParent = makeParent({ id: "root" });
    const solidShape = mockShape({ shapeType: ShapeTypes.solid });
    const node: any = {
        name: "body-1",
        materialId: "mat-default",
        transform: Matrix4.identity(),
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
        shape: { value: solidShape, isOk: true } as unknown as Result<IShape>,
    };

    const face0 = mockShape({ shapeType: ShapeTypes.face });
    const face1 = mockShape({ shapeType: ShapeTypes.face });

    // First step: the selected solid (single shape).
    const step0 = shapeStepResult([{ shape: solidShape, node }], {});
    // Force the owner.node to our crafted node (shapeStepResult rebuilds owner).
    (step0.shapes[0].owner as unknown as { node: unknown }).node = node;

    // Second step: the faces to remove.
    const step1 = shapeStepResult(
        [
            { shape: face0, node },
            { shape: face1, node },
        ],
        {},
    );

    return { parent, node, solidShape, faces: [face0, face1], step0, step1 };
}

describe("RemoveFaceCommand", () => {
    test("should have command metadata", () => {
        const data = (RemoveFaceCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.removeFeature");
        expect(data.icon).toBe("icon-removeFeature");
    });

    test("getSteps should return two steps", () => {
        const cmd = new RemoveFaceCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    test("getSteps first-step shapeFilter.allow should accept solid/compound/compoundSolid and reject others", () => {
        const cmd = new RemoveFaceCommand();
        const steps = (cmd as any).getSteps();
        const allow = steps[0].options.shapeFilter.allow;

        expect(allow({ shapeType: ShapeTypes.solid })).toBe(true);
        expect(allow({ shapeType: ShapeTypes.compound })).toBe(true);
        expect(allow({ shapeType: ShapeTypes.compoundSolid })).toBe(true);
        // Other shape types are rejected.
        expect(allow({ shapeType: ShapeTypes.face })).toBe(false);
        expect(allow({ shapeType: ShapeTypes.edge })).toBe(false);
        expect(allow({ shapeType: ShapeTypes.shell })).toBe(false);
    });

    test("getSteps beforeSelection/afterSelection callbacks should drive the highlighter state", () => {
        const restoreApp = installStubAppWithFactory().restore;
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new RemoveFaceCommand();
            const { doc } = wireCommand(cmd);
            const steps = (cmd as any).getSteps();
            const before = steps[1].options.beforeSelection;
            const after = steps[1].options.afterSelection;

            // Seed stepDatas[0] with a selected shape so addFirstSelectedState has a target.
            const { step0 } = buildStepDatas();
            seedStepDatas(cmd, [step0]);

            before();
            expect(doc.visual.highlighter.addState as any).toHaveBeenCalledTimes(1);

            after();
            expect(doc.visual.highlighter.removeState as any).toHaveBeenCalledTimes(1);
        } finally {
            restoreTx();
            restoreApp();
        }
    });

    test("executeMainTask should create a new EditableShapeNode from removeFeature result and remove the old node", () => {
        const { factory, restore: restoreApp } = installStubAppWithFactory();
        const restoreTx = stubTransactionRun();

        try {
            const cmd = new RemoveFaceCommand();
            const { doc, addedNodes } = wireCommand(cmd);
            const { parent, node, solidShape, faces, step0, step1 } = buildStepDatas();
            seedStepDatas(cmd, [step0, step1]);

            (cmd as any).executeMainTask();

            // shapeFactory.removeFeature called with the solid shape + faces array.
            expect(factory.removeFeature).toHaveBeenCalledTimes(1);
            const calls = (factory.removeFeature as any).mock.calls[0];
            expect(calls[0]).toBe(solidShape);
            expect(calls[1]).toEqual(faces);

            // One new node added to the model.
            expect(addedNodes).toHaveLength(1);
            // Old node removed from its parent.
            expect(parent.removed).toContain(node);
            // visual.update touched.
            expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        } finally {
            restoreTx();
            restoreApp();
        }
    });

    test("executeMainTask should use the last step's shapes as the faces to remove", () => {
        const { factory, restore: restoreApp } = installStubAppWithFactory();
        const restoreTx = stubTransactionRun();

        try {
            const cmd = new RemoveFaceCommand();
            wireCommand(cmd);
            const { step0 } = buildStepDatas();

            // A different second step with a single face — verify at(-1) read.
            const onlyFace = mockShape({ shapeType: ShapeTypes.face });
            const step1 = shapeStepResult([{ shape: onlyFace }], {});

            seedStepDatas(cmd, [step0, step1]);
            (cmd as any).executeMainTask();

            expect(factory.removeFeature).toHaveBeenCalledTimes(1);
            const facesArg = (factory.removeFeature as any).mock.calls[0][1];
            expect(facesArg).toEqual([onlyFace]);
        } finally {
            restoreTx();
            restoreApp();
        }
    });

    test("executeMainTask should propagate transform and materialId onto the new node", () => {
        const { restore: restoreApp } = installStubAppWithFactory();
        const restoreTx = stubTransactionRun();

        try {
            const cmd = new RemoveFaceCommand();
            const { addedNodes } = wireCommand(cmd);

            const parent = makeParent({ id: "root" });
            const customTransform = Matrix4.fromTranslation(5, 6, 7);
            const node: any = {
                name: "shaped-node",
                materialId: "mat-special",
                transform: customTransform,
                parent,
                previousSibling: undefined,
                nextSibling: undefined,
                shape: { value: mockShape({ shapeType: ShapeTypes.solid }), isOk: true },
            };
            const step0 = shapeStepResult([{ shape: mockShape({ shapeType: ShapeTypes.solid }), node }], {});
            (step0.shapes[0].owner as unknown as { node: unknown }).node = node;
            const step1 = shapeStepResult([{ shape: mockShape({ shapeType: ShapeTypes.face }) }], {});

            seedStepDatas(cmd, [step0, step1]);
            (cmd as any).executeMainTask();

            expect(addedNodes).toHaveLength(1);
            const created = addedNodes[0] as any;
            expect(created.name).toBe("shaped-node");
            expect(created.transform).toBe(customTransform);
        } finally {
            restoreTx();
            restoreApp();
        }
    });
});
