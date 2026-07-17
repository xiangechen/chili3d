// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IApplication,
    type IShape,
    Matrix4,
    PubSub,
    Result,
    ShapeTypes,
    type VisualShapeData,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { RemoveSubShapesCommand } from "../../../src/commands/modify/removeSubShapes";
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
 * Install a stub global `app` whose `shapeProvider.factory` is a concrete
 * object so tests can assert exactly which factory method ran and with what
 * args. `factory.removeSubShape` is overridable per-test.
 */
function installStubAppWithFactory(removeSubShape: (...args: any[]) => Result<IShape>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
    const factory = { removeSubShape: rs.fn(removeSubShape) };
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
 * Build the two SelectShapeStep results removeSubShapes consumes:
 *  - stepDatas[0]: a single selected shape (owner.node read for shape + transform)
 *  - stepDatas.at(-1): the sub-shapes to remove (mapped to `x.shape`)
 */
function buildStepDatas(opts: { previousSibling?: unknown } = {}) {
    const parent: TrackingParent = makeParent({ id: "root" });
    const solidShape = mockShape({ shapeType: ShapeTypes.solid });
    const previousSibling = opts.previousSibling ?? undefined;
    const node: any = {
        name: "body-1",
        materialId: "mat-default",
        transform: Matrix4.identity(),
        parent,
        previousSibling,
        nextSibling: undefined,
        shape: { value: solidShape, isOk: true } as unknown as Result<IShape>,
    };

    const edge0 = mockShape({ shapeType: ShapeTypes.edge });
    const face0 = mockShape({ shapeType: ShapeTypes.face });

    const step0 = shapeStepResult([{ shape: solidShape, node }], {});
    (step0.shapes[0].owner as unknown as { node: unknown }).node = node;
    const step1 = shapeStepResult(
        [
            { shape: edge0, node },
            { shape: face0, node },
        ],
        {},
    );
    return { parent, node, solidShape, subShapes: [edge0, face0], step0, step1 };
}

describe("RemoveSubShapesCommand", () => {
    test("should have command metadata", () => {
        const data = (RemoveSubShapesCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.removeShapes");
        expect(data.icon).toBe("icon-removeSubShape");
    });

    test("getSteps should return two steps", () => {
        const cmd = new RemoveSubShapesCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    test("getSteps first-step shapeFilter.allow should reject vertex/edge and accept other shape types", () => {
        const cmd = new RemoveSubShapesCommand();
        const steps = (cmd as any).getSteps();
        const allow = steps[0].options.shapeFilter.allow;

        expect(allow({ shapeType: ShapeTypes.vertex })).toBe(false);
        expect(allow({ shapeType: ShapeTypes.edge })).toBe(false);
        // Everything else is accepted.
        expect(allow({ shapeType: ShapeTypes.solid })).toBe(true);
        expect(allow({ shapeType: ShapeTypes.face })).toBe(true);
        expect(allow({ shapeType: ShapeTypes.wire })).toBe(true);
    });

    test("getSteps beforeSelection/afterSelection callbacks should drive the highlighter state", () => {
        const { restore: restoreApp } = installStubAppWithFactory(() =>
            Result.ok(mockShape({ shapeType: ShapeTypes.solid })),
        );
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new RemoveSubShapesCommand();
            const { doc } = wireCommand(cmd);
            const steps = (cmd as any).getSteps();
            const before = steps[1].options.beforeSelection;
            const after = steps[1].options.afterSelection;

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

    test("executeMainTask should insert a new node after the previous sibling and remove the old node (success path)", () => {
        const previousMarker = { id: "prev" };
        const { factory, restore: restoreApp } = installStubAppWithFactory(() =>
            Result.ok(mockShape({ shapeType: ShapeTypes.solid })),
        );
        const restoreTx = stubTransactionRun();

        try {
            const cmd = new RemoveSubShapesCommand();
            const { doc } = wireCommand(cmd);
            const { parent, node, solidShape, subShapes, step0, step1 } = buildStepDatas({
                previousSibling: previousMarker,
            });
            seedStepDatas(cmd, [step0, step1]);

            (cmd as any).executeMainTask();

            // shapeFactory.removeSubShape invoked with shape value + sub-shape list.
            expect(factory.removeSubShape).toHaveBeenCalledTimes(1);
            const [shapeArg, subsArg] = factory.removeSubShape.mock.calls[0];
            expect(shapeArg).toBe(solidShape);
            expect(subsArg).toEqual(subShapes);

            // New node inserted after previous sibling, old node removed.
            expect(parent.insertedAfter).toHaveLength(1);
            expect(parent.insertedAfter[0].target).toBe(previousMarker);
            expect(parent.removed).toContain(node);
            expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        } finally {
            restoreTx();
            restoreApp();
        }
    });

    test("executeMainTask should map the last step's shapes (not the first) as the sub-shapes", () => {
        const { factory, restore: restoreApp } = installStubAppWithFactory(() =>
            Result.ok(mockShape({ shapeType: ShapeTypes.solid })),
        );
        const restoreTx = stubTransactionRun();

        try {
            const cmd = new RemoveSubShapesCommand();
            wireCommand(cmd);
            const { step0 } = buildStepDatas();

            const onlyEdge = mockShape({ shapeType: ShapeTypes.edge });
            const step1 = shapeStepResult([{ shape: onlyEdge }], {});

            seedStepDatas(cmd, [step0, step1]);
            (cmd as any).executeMainTask();

            expect(factory.removeSubShape).toHaveBeenCalledTimes(1);
            expect(factory.removeSubShape.mock.calls[0][1]).toEqual([onlyEdge]);
        } finally {
            restoreTx();
            restoreApp();
        }
    });

    test("executeMainTask should publish a toast and not insert/remove nodes when shape result is an error", () => {
        const { factory, restore: restoreApp } = installStubAppWithFactory(() =>
            Result.err("remove failed: invalid sub-shape"),
        );
        const restoreTx = stubTransactionRun();
        const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});

        try {
            const cmd = new RemoveSubShapesCommand();
            wireCommand(cmd);
            const { parent, step0, step1 } = buildStepDatas();
            seedStepDatas(cmd, [step0, step1]);

            (cmd as any).executeMainTask();

            expect(factory.removeSubShape).toHaveBeenCalledTimes(1);
            // Toast emitted with the error.
            expect(pubSpy).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "remove failed: invalid sub-shape",
            );
            // No node mutation on failure.
            expect(parent.insertedAfter).toHaveLength(0);
            expect(parent.removed).toHaveLength(0);
        } finally {
            pubSpy.mockRestore();
            restoreTx();
            restoreApp();
        }
    });
});
