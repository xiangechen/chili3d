// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Matrix4 } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { Split } from "../../../src/commands/modify/split";
import {
    ensureGlobalStubApp,
    type MockShape,
    makeParent,
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

/** Attach a recording `split` method to a mock shape that returns `result`. */
function recordSplit(shape: MockShape, result: MockShape) {
    (shape as any).split = (...args: any[]) => {
        const existing = shape.calls.get("split") ?? [];
        existing.push(args);
        shape.calls.set("split", existing);
        return result;
    };
    return shape;
}

/**
 * Build a split command. `subShapes` controls what `shape.directSubShapes()`
 * returns, so tests can drive the multi-node (>1) vs single-node (===1) branch.
 */
function buildSplitCommand(subShapes: MockShape[]) {
    const cmd = new Split();
    const { doc } = wireCommand(cmd);

    const splitResult = mockShape({
        directSubShapes: () => subShapes,
    } as Partial<MockShape>);

    // shape1.split(edges) is what the command calls; the result becomes the
    // parent whose directSubShapes() are enumerated. Record the call.
    const shape1 = recordSplit(mockShape(), splitResult);

    const oldParent = makeParent({ id: "old-parent" }) as TrackingParent;
    const oldNode = {
        name: "solid0",
        transform: Matrix4.identity(),
        parent: oldParent,
        previousSibling: undefined,
        nextSibling: undefined,
    };

    const step0 = shapeStepResult([{ shape: shape1 as Partial<IShape>, node: oldNode }]);
    (step0 as any).nodes = [oldNode];

    // The cutting shapes need `.transformedMul(transform.multiply(invertTransform))`.
    // mockShape already returns a tracking transformedMul; we just need one entry.
    const cutShape = mockShape();
    const cutParent = makeParent({ id: "cut-parent" }) as TrackingParent;
    const step1 = shapeStepResult([{ shape: cutShape as Partial<IShape> }]);
    // Stash the cut shape's owner so removeModels can find a node to remove.
    const cutOwner = step1.shapes[0].owner as any;

    seedStepDatas(cmd, [step0, step1]);

    // `removeModels` queries `document.visual.context.getNode(owner)` for each
    // owner; wire it so the cut owner resolves to a node with our tracking parent.
    (doc.visual.context.getNode as any).mockImplementation((owner: unknown) => {
        if (owner === step0.shapes[0].owner) {
            return { parent: oldParent };
        }
        if (owner === cutOwner) {
            return { parent: cutParent };
        }
        return undefined;
    });

    return { cmd, oldParent, cutParent, shape1, cutShape };
}

describe("Split", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (Split as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.split");
        expect(data.icon).toBe("icon-split");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Split();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("executeMainTask", () => {
        test("should add one EditableShapeNode per sub-shape when the split yields several", () => {
            const subShapes = [mockShape(), mockShape(), mockShape()];
            const { cmd, oldParent, shape1, cutShape } = buildSplitCommand(subShapes);

            (cmd as any).executeMainTask();

            // split(edges) was invoked once with the transformed cutting edges.
            expect(shape1.calls.get("split")).toHaveLength(1);
            // Each cutting shape was transformed via transformedMul.
            expect(cutShape.calls.get("transformedMul")).toHaveLength(1);
            // Three new nodes (named solid01, solid02, solid03) appended to the old parent.
            expect(oldParent.added).toHaveLength(3);
            expect((oldParent.added[0] as any).name).toBe("solid01");
            expect((oldParent.added[2] as any).name).toBe("solid03");
        });

        test("should add a single EditableShapeNode keeping the original name when only one sub-shape results", () => {
            const { cmd, oldParent } = buildSplitCommand([mockShape()]);

            (cmd as any).executeMainTask();

            expect(oldParent.added).toHaveLength(1);
            expect((oldParent.added[0] as any).name).toBe("solid0");
        });

        test("should dispose the cutting edges after splitting", () => {
            const disposeCalls: number[] = [];
            const cutShape = mockShape({ dispose: () => disposeCalls.push(1) } as Partial<MockShape>);
            const cmd = new Split();
            wireCommand(cmd);

            const splitResult = mockShape({ directSubShapes: () => [mockShape()] } as Partial<MockShape>);
            const shape1 = recordSplit(mockShape(), splitResult);
            const oldParent = makeParent({ id: "old-parent" }) as TrackingParent;
            const oldNode = {
                name: "solid0",
                transform: Matrix4.identity(),
                parent: oldParent,
                previousSibling: undefined,
                nextSibling: undefined,
            };

            const step0 = shapeStepResult([{ shape: shape1 as Partial<IShape>, node: oldNode }]);
            (step0 as any).nodes = [oldNode];
            const step1 = shapeStepResult([{ shape: cutShape as Partial<IShape> }]);
            seedStepDatas(cmd, [step0, step1]);

            (cmd as any).executeMainTask();

            expect(disposeCalls).toHaveLength(1);
        });
    });
});
