// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IShape, Matrix4, Result, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { booleanInWorld, buildTargetPreview, worldShape } from "../../src/commands/booleanPreview";
import type { BooleanOperation } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

/** Distinct from the tool's, so a test can tell which shape reached the viewport. */
const RESULT_COLOR = 1;

function mockShapeFactory(results: Partial<Record<"fuse" | "cut" | "common", Result<IShape>>>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    const spies = {
        booleanFuse: rs.fn((_targets: IShape[], _tools: IShape[]) => results.fuse ?? Result.err("no")),
        booleanCut: rs.fn((_targets: IShape[], _tools: IShape[]) => results.cut ?? Result.err("no")),
        booleanCommon: rs.fn((_targets: IShape[], _tools: IShape[]) => results.common ?? Result.err("no")),
    };
    Object.defineProperty(globalThis, "shapeFactory", { value: spies, writable: true, configurable: true });
    return {
        ...spies,
        restore: () => {
            if (previous) Object.defineProperty(globalThis, "shapeFactory", previous);
            else delete (globalThis as any).shapeFactory;
        },
    };
}

function result(disposed: boolean[] = [], color = RESULT_COLOR) {
    let isDisposed = false;
    return {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        mesh: { faces: { color } },
        dispose: () => {
            isDisposed = true;
            disposed.push(true);
        },
        get disposed() {
            return isDisposed;
        },
    } as unknown as IShape & { disposed: boolean };
}

const tool = () =>
    ({
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        boundingBox: () => BoundingBox.zero,
        dispose: rs.fn(() => {}),
    }) as unknown as IShape;

function body(
    doc: TestDocument,
    id: string,
    transform = Matrix4.identity(),
): { node: ParametricBodyNode; local: any; world: any } {
    const node = new ParametricBodyNode({ document: doc, id, features: [] });
    const local = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        boundingBox: () => BoundingBox.zero,
    };
    const world = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        boundingBox: () => BoundingBox.zero,
        dispose: rs.fn(() => {}),
    };
    (local as any).transformedMul = rs.fn(() => world);
    (node as any)._shape = Result.ok(local);
    (node as any).setPrivateValue("transform", transform);
    doc.modelManager.addNode(node);
    return { node, local, world };
}

function scenario() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

describe("booleanInWorld", () => {
    test.each(["fuse", "cut", "common"] as BooleanOperation[])("sends %s to its own boolean", (operation) => {
        const doc = scenario();
        const { node } = body(doc, "b1");
        const built = result();
        const factory = mockShapeFactory({ [operation]: Result.ok(built) });
        try {
            expect(booleanInWorld(operation, tool(), node).isOk).toBe(true);
            expect(factory[`boolean${operation[0].toUpperCase()}${operation.slice(1)}` as "booleanFuse"]) //
                .toHaveBeenCalledTimes(1);
        } finally {
            factory.restore();
        }
    });

    test("measures a moved body where it is displayed, then frees the copy", () => {
        const doc = scenario();
        const { node, local, world } = body(doc, "b1", Matrix4.fromTranslation(100, 0, 0));
        const factory = mockShapeFactory({ fuse: Result.ok(result()) });
        try {
            expect(booleanInWorld("fuse", tool(), node).isOk).toBe(true);

            // The tool is world-space, so the body has to be moved out there too.
            expect(local.transformedMul).toHaveBeenCalledWith(Matrix4.fromTranslation(100, 0, 0));
            expect(factory.booleanFuse.mock.calls[0][0]).toEqual([world]);
            // The moved copy is the preview's to free once the kernel has read it.
            expect(world.dispose).toHaveBeenCalled();
        } finally {
            factory.restore();
        }
    });

    test("does not consume the tool", () => {
        const doc = scenario();
        const { node } = body(doc, "b1");
        const prism = tool();
        const factory = mockShapeFactory({ fuse: Result.ok(result()) });
        try {
            booleanInWorld("fuse", prism, node);

            expect(prism.dispose).not.toHaveBeenCalled();
        } finally {
            factory.restore();
        }
    });
});

describe("buildTargetPreview", () => {
    test("meshes every target's result and stands in for all of them", () => {
        const doc = scenario();
        const first = body(doc, "b1").node;
        const second = body(doc, "b2").node;
        const built = result();
        const factory = mockShapeFactory({ fuse: Result.ok(built) });
        try {
            const preview = buildTargetPreview("fuse", tool(), [first, second]);

            expect(preview.meshes).toEqual([{ color: RESULT_COLOR }, { color: RESULT_COLOR }]);
            expect(preview.hidden).toEqual([first, second]);
            // The results are the preview's, not the viewport's: meshed, then freed.
            expect(built.disposed).toBe(true);
        } finally {
            factory.restore();
        }
    });

    test("a target whose boolean fails is neither shown nor hidden", () => {
        const doc = scenario();
        const failing = body(doc, "b1").node;
        const working = body(doc, "b2").node;
        let first = true;
        const factory = mockShapeFactory({});
        factory.booleanFuse.mockImplementation(() => {
            if (first) {
                first = false;
                return Result.err("no intersection");
            }
            return Result.ok(result());
        });
        try {
            const preview = buildTargetPreview("fuse", tool(), [failing, working]);

            // Hiding a body whose result is not shown would blank geometry the user can
            // still see — the failing body reports from its own chain instead.
            expect(preview.hidden).toEqual([working]);
            expect(preview.meshes).toHaveLength(1);
        } finally {
            factory.restore();
        }
    });
});

describe("worldShape", () => {
    test("reuses the shape an identity transform leaves where it is", () => {
        const shape = tool();
        const owned: IShape[] = [];

        expect(worldShape(shape, Matrix4.identity(), owned)).toBe(shape);
        expect(owned).toEqual([]);
    });

    test("hands back a copy for the caller to free when the transform moves it", () => {
        const { local, world } = body(scenario(), "b1", Matrix4.fromTranslation(1, 0, 0));
        const owned: IShape[] = [];

        expect(worldShape(local, Matrix4.fromTranslation(1, 0, 0), owned)).toBe(world);
        expect(owned).toEqual([world]);
    });
});
