// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, type IView, Matrix4, XYZ } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { Break } from "../../../src/commands/modify/break";
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

interface MockCurve {
    parameter: (p: XYZ, tol: number) => number | undefined;
    lastParameter: () => number;
    firstParameter: () => number;
    trim: (a: number, b: number) => { dispose: () => void };
    setTrim: (a: number, b: number) => void;
    calls: Map<string, unknown[][]>;
}

/** A trimmed-curve mock that records every call. */
function mockCurve(overrides: Partial<MockCurve> = {}): MockCurve {
    const calls = new Map<string, unknown[][]>();
    const record = <K extends string>(name: K, impl: (...args: unknown[]) => unknown) => {
        return (...args: unknown[]) => {
            const existing = calls.get(name) ?? [];
            existing.push(args);
            calls.set(name, existing);
            return impl(...args);
        };
    };
    const curve: MockCurve = {
        parameter: record("parameter", () => 0.5) as MockCurve["parameter"],
        lastParameter: record("lastParameter", () => 1) as MockCurve["lastParameter"],
        firstParameter: record("firstParameter", () => 0) as MockCurve["firstParameter"],
        trim: record("trim", () => ({ dispose: () => {} })) as MockCurve["trim"],
        setTrim: record("setTrim", () => {}) as MockCurve["setTrim"],
        calls,
        ...overrides,
    };
    // Ensure overrides that supply new implementations still record.
    return curve;
}

function buildBreakCommand(curveOverride: Partial<MockCurve> = {}) {
    const cmd = new Break();
    wireCommand(cmd);

    const curve = mockCurve(curveOverride);
    const edgeShape = mockShape({
        // IEdge.shape: `shape.curve`, `shape.update(curve)`, `shape.matrix`
        curve,
        update: () => {},
        matrix: Matrix4.identity(),
    } as Partial<MockShape>);

    const parent = makeParent({ id: "edge-parent" }) as TrackingParent;
    const modelNode = {
        name: "edge0",
        transform: Matrix4.identity(),
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
        // break reads `.worldTransform()` from `owner.node`.
        worldTransform: () => Matrix4.identity(),
    };

    const step0 = shapeStepResult([{ shape: edgeShape as Partial<IShape>, node: modelNode }]);
    (step0 as any).nodes = [modelNode];
    // Make sure `owner.node` is our node with `worldTransform`.
    (step0.shapes[0].owner as any).node = modelNode;

    const step1 = {
        view: { workplane: undefined, direction: () => XYZ.unitNZ } as unknown as IView,
        type: "input" as const,
        point: new XYZ({ x: 1, y: 2, z: 3 }),
        shapes: [],
    };

    seedStepDatas(cmd, [step0, step1]);
    return { cmd, parent, curve, edgeShape, modelNode };
}

describe("Break", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (Break as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.break");
        expect(data.icon).toBe("icon-break");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Break();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("executeMainTask", () => {
        test("should split the edge into two EditableShapeNodes inserted after the original", () => {
            const { cmd, parent, curve } = buildBreakCommand();

            (cmd as any).executeMainTask();

            // trim + setTrim + update were all called on the source curve/edge.
            expect(curve.calls.get("trim")).toHaveLength(1);
            expect(curve.calls.get("setTrim")).toHaveLength(1);
            // Two new nodes inserted after the original, and the original removed.
            expect(parent.insertedAfter).toHaveLength(2);
            expect(parent.removed).toHaveLength(1);
            expect((parent.insertedAfter[0] as any).node.name).toBe("edge0_1");
            expect((parent.insertedAfter[1] as any).node.name).toBe("edge0_2");
        });

        test("should early-return without changes when curve.parameter is undefined", () => {
            const { cmd, parent } = buildBreakCommand({ parameter: () => undefined });

            (cmd as any).executeMainTask();

            expect(parent.insertedAfter).toHaveLength(0);
            expect(parent.removed).toHaveLength(0);
        });

        test("should call curve.parameter with the picked point in local space", () => {
            const { cmd, curve } = buildBreakCommand();

            (cmd as any).executeMainTask();

            expect(curve.calls.get("parameter")).toHaveLength(1);
            const [point, tol] = curve.calls.get("parameter")![0] as [XYZ, number];
            // worldTransform is identity, so the local point equals the picked point.
            expect(point.x).toBeCloseTo(1, 6);
            expect(point.y).toBeCloseTo(2, 6);
            expect(point.z).toBeCloseTo(3, 6);
            expect(tol).toBeCloseTo(1e-3, 10);
        });
    });

    describe("handlePointData", () => {
        test("should build a transformed curve plus a D1 preview that projects the picked point", () => {
            const cmd = new Break();
            wireCommand(cmd);

            const transformedCurve = {
                project: (p: XYZ) => [new XYZ({ x: p.x, y: p.y, z: p.z })],
                dispose: () => {},
            };
            const baseCurve = {
                transformed: () => transformedCurve,
                dispose: () => {},
            };
            const edgeShape = mockShape({
                curve: baseCurve,
                matrix: Matrix4.identity(),
            } as Partial<MockShape>);

            const step0 = shapeStepResult([{ shape: edgeShape as Partial<IShape> }]);
            seedStepDatas(cmd, [step0]);

            const data = (cmd as any).handlePointData();

            // The transformed curve was registered on the dispose stack.
            expect((cmd as any).disposeStack.has(transformedCurve)).toBe(true);
            expect(data.dimension).toBe(1); // Dimensions.D1
            // preview(undefined) returns no meshes; preview(point) returns one vertex mesh.
            expect(data.preview(undefined)).toHaveLength(0);
            const preview = data.preview(new XYZ({ x: 5, y: 6, z: 7 }));
            expect(preview).toHaveLength(1);
        });
    });
});
