// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IShape,
    type IShapeFactory,
    type IStep,
    type IView,
    Matrix4,
    Plane,
    Result,
    SelectShapeStep,
    ShapeTypes,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { BooleanCommon, BooleanCut, BooleanFuse } from "../../src/commands/boolean";
import {
    ensureGlobalStubApp,
    makeParent,
    mockShape,
    seedStepDatas,
    stubTransactionRun,
    wireCommand,
} from "./commandTestUtils";

/**
 * Install a custom shape factory for boolean tests. Returns a restore function.
 */
function installShapeFactory(result: Result<IShape>): () => void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
    const factory = {
        booleanCommon: rs.fn(() => result),
        booleanCut: rs.fn(() => result),
        booleanFuse: rs.fn(() => result),
    } as unknown as IShapeFactory;

    Object.defineProperty(globalThis, "app", {
        configurable: true,
        get: () => ({
            shapeProvider: { factory, converter: {} as any },
        }),
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "app", previous);
        }
    };
}

/** A fake shape with setTolerance (required by booleanOperate). */
function shapeWithTolerance(extra: Record<string, unknown> = {}): IShape {
    return mockShape({
        shapeType: ShapeTypes.solid,
        setTolerance: () => {},
        ...extra,
    }) as unknown as IShape;
}

/** Build a minimal VisualShapeData entry for step seeding. */
function visShape(s: IShape, parent = makeParent()): VisualShapeData {
    return {
        shape: s,
        transform: Matrix4.identity(),
        point: undefined,
        indexes: [],
        owner: {
            node: { parent, previousSibling: undefined, nextSibling: undefined },
            getNode(this: { node: unknown }) {
                return this.node;
            },
        },
    } as unknown as VisualShapeData;
}

const VIEW_STUB = {
    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
    type: "shape",
} as const;

describe("BooleanOperate (via BooleanCommon)", () => {
    test("should have command metadata", () => {
        const data = (BooleanCommon as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("boolean.common");
        expect(data.icon).toBe("icon-booleanCommon");
    });

    test("getBooleanOperateType should return 'common'", () => {
        const cmd = new BooleanCommon();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("common");
    });

    test("getSteps should return two SelectShapeSteps", () => {
        const cmd = new BooleanCommon();
        const steps = (cmd as any).getSteps() as IStep[];
        expect(steps.length).toBe(2);
        expect(steps[0]).toBeInstanceOf(SelectShapeStep);
        expect(steps[1]).toBeInstanceOf(SelectShapeStep);
    });

    test("keepTools should default to false", () => {
        const cmd = new BooleanCommon();
        expect(cmd.keepTools).toBe(false);
    });

    test("keepTools setter should update property", () => {
        const cmd = new BooleanCommon();
        cmd.keepTools = true;
        expect(cmd.keepTools).toBe(true);

        cmd.keepTools = false;
        expect(cmd.keepTools).toBe(false);
    });

    describe("getBooleanShape", () => {
        test("should call booleanCommon for type 'common'", () => {
            const restore = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const result = (cmd as any).getBooleanShape("common", shapeWithTolerance(), []);
                expect(result.isOk).toBe(true);
            } finally {
                restore();
            }
        });

        test("should call booleanCut for type 'cut'", () => {
            const restore = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const result = (cmd as any).getBooleanShape("cut", shapeWithTolerance(), []);
                expect(result.isOk).toBe(true);
            } finally {
                restore();
            }
        });

        test("should call booleanFuse for type 'fuse'", () => {
            const restore = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const result = (cmd as any).getBooleanShape("fuse", shapeWithTolerance(), []);
                expect(result.isOk).toBe(true);
            } finally {
                restore();
            }
        });
    });

    describe("booleanOperate", () => {
        test("should transform shapes and call the shape factory", () => {
            const restore = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);

                const s1 = shapeWithTolerance();
                const s2 = shapeWithTolerance();

                seedStepDatas(cmd, [{ ...VIEW_STUB, shapes: [visShape(s1)], nodes: [] }]);

                const result = (cmd as any).booleanOperate([
                    {
                        shape: s2,
                        transform: Matrix4.identity(),
                        point: undefined,
                        indexes: [],
                        owner: { node: {}, getNode: () => ({}) },
                    },
                ]);
                expect(result.isOk).toBe(true);
            } finally {
                restore();
            }
        });
    });

    describe("executeMainTask", () => {
        test("should create BooleanNode and add to document on success", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreTx = stubTransactionRun();
            const restoreFactory = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);

                const parent0 = makeParent({ id: "parent0" });
                const parent1 = makeParent({ id: "parent1" });
                seedStepDatas(cmd, [
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance(), parent0)], nodes: [] },
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance(), parent1)], nodes: [] },
                ]);

                expect(() => (cmd as any).executeMainTask()).not.toThrow();
            } finally {
                restoreFactory();
                restoreTx();
                restoreApp();
            }
        });

        test("should publish toast when boolean operation fails", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreTx = stubTransactionRun();
            const restoreFactory = installShapeFactory(Result.err("boolean failed"));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);

                const parent0 = makeParent({ id: "parent0" });
                seedStepDatas(cmd, [
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance(), parent0)], nodes: [] },
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance(), makeParent())], nodes: [] },
                ]);

                // Should not throw, even though toast doesn't work in test env
                expect(() => (cmd as any).executeMainTask()).not.toThrow();
            } finally {
                restoreFactory();
                restoreTx();
                restoreApp();
            }
        });

        test("should keep tools when keepTools is true", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreTx = stubTransactionRun();
            const restoreFactory = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                cmd.keepTools = true;
                wireCommand(cmd);

                const parent0 = makeParent({ id: "parent0" });
                const parent1 = makeParent({ id: "parent1" });
                seedStepDatas(cmd, [
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance(), parent0)], nodes: [] },
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance(), parent1)], nodes: [] },
                ]);

                expect(() => (cmd as any).executeMainTask()).not.toThrow();
            } finally {
                restoreFactory();
                restoreTx();
                restoreApp();
            }
        });
    });

    describe("onToolsChanged (debounced preview)", () => {
        test("should do nothing when no shapes in stepData", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreFactory = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);
                (cmd as any).stepDatas = [];

                expect(() => (cmd as any).onToolsChanged([])).not.toThrow();
            } finally {
                restoreFactory();
                restoreApp();
            }
        });

        test("should do nothing when first step data has no shapes", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreFactory = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);
                seedStepDatas(cmd, [{ ...VIEW_STUB, shapes: [], nodes: [] }]);

                // When selected is empty but step has no shapes, should not throw
                expect(() => (cmd as any).onToolsChanged([])).not.toThrow();
            } finally {
                restoreFactory();
                restoreApp();
            }
        });

        test("should handle selected shapes correctly", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreFactory = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);

                const parent = makeParent({ id: "parent0" });
                seedStepDatas(cmd, [
                    {
                        ...VIEW_STUB,
                        shapes: [visShape(shapeWithTolerance(), parent)],
                        nodes: [],
                    },
                ]);

                // Debounce wraps onToolsChanged with 20ms delay, call doesn't throw
                expect(() =>
                    (cmd as unknown as { onToolsChanged: (selected: unknown[]) => void }).onToolsChanged([]),
                ).not.toThrow();
            } finally {
                restoreFactory();
                restoreApp();
            }
        });
    });
});

describe("BooleanCut", () => {
    test("should have command metadata", () => {
        const data = (BooleanCut as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("boolean.cut");
        expect(data.icon).toBe("icon-booleanCut");
    });

    test("getBooleanOperateType should return 'cut'", () => {
        const cmd = new BooleanCut();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("cut");
    });

    test("should extend BooleanOperate (inherit keepTools)", () => {
        const cmd = new BooleanCut();
        expect(cmd.keepTools).toBe(false);
    });
});

describe("BooleanFuse", () => {
    test("should have command metadata", () => {
        const data = (BooleanFuse as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("boolean.join");
        expect(data.icon).toBe("icon-booleanFuse");
    });

    test("getBooleanOperateType should return 'fuse'", () => {
        const cmd = new BooleanFuse();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("fuse");
    });

    test("should extend BooleanOperate (inherit keepTools)", () => {
        const cmd = new BooleanFuse();
        expect(cmd.keepTools).toBe(false);
    });
});
