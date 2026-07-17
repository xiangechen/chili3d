// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4 } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { RepairShapeCommand } from "../../../src/commands/modify/repair";
import {
    ensureGlobalStubApp,
    type MockShape,
    mockShape,
    nodeStepResult,
    seedStepDatas,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

/** A mock shape that chains the four repair operations back to itself, recording each call. */
function repairableShape(): MockShape {
    const base = mockShape();
    const record = (name: string, impl: (...args: any[]) => any) => {
        return (...args: any[]) => {
            const existing = base.calls.get(name) ?? [];
            existing.push(args);
            base.calls.set(name, existing);
            return impl(...args);
        };
    };
    (base as any).setTolerance = record("setTolerance", () => base);
    (base as any).shellSewing = record("shellSewing", () => base);
    (base as any).fixShape = record("fixShape", () => base);
    (base as any).fixSmallFace = record("fixSmallFace", () => base);
    return base;
}

/**
 * Build a node for the repair command: it reads `stepDatas[0].nodes[i].shape.value`
 * and `node.transform`, `node.parent`, `node.name`, `node.materialId`.
 */
function buildRepairCommand(nodeCount = 1) {
    const cmd = new RepairShapeCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const shapes: MockShape[] = [];
    const nodes = Array.from({ length: nodeCount }, (_, i) => {
        const shape = repairableShape();
        shapes.push(shape);
        return {
            name: `node${i}`,
            shape: { value: shape },
            transform: Matrix4.identity(),
            materialId: `mat-${i}`,
            parent,
            previousSibling: undefined,
            nextSibling: undefined,
        };
    });

    const step0 = nodeStepResult(nodes as any);
    seedStepDatas(cmd, [step0]);
    return { cmd, parent, nodes, shapes };
}

describe("RepairShapeCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (RepairShapeCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.repairShape");
        expect(data.icon).toBe("icon-repair");
    });

    test("tolerance should default to 1e-5", () => {
        const cmd = new RepairShapeCommand();
        expect(cmd.tolerance).toBe(1e-5);
    });

    test("tolerance setter should update property", () => {
        const cmd = new RepairShapeCommand();
        cmd.tolerance = 1e-4;
        expect(cmd.tolerance).toBe(1e-4);
    });

    test("getSteps should return one step", () => {
        const cmd = new RepairShapeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    describe("executeMainTask", () => {
        test("should add a repaired EditableShapeNode and remove the original for each node", () => {
            const { cmd, parent, shapes } = buildRepairCommand(2);

            (cmd as any).executeMainTask();

            // Each shape had its repair pipeline invoked.
            expect(shapes[0].calls.get("setTolerance")).toBeDefined();
            expect(shapes[0].calls.get("shellSewing")).toBeDefined();
            expect(shapes[1].calls.get("fixShape")).toBeDefined();
            expect(shapes[1].calls.get("fixSmallFace")).toBeDefined();

            expect(parent.added).toHaveLength(2);
            expect(parent.removed).toHaveLength(2);
            expect((parent.added[0] as any).name).toBe("node0_repaired");
            expect((parent.added[1] as any).name).toBe("node1_repaired");
        });

        test("should early-return without changes when stepDatas[0].nodes is undefined", () => {
            const cmd = new RepairShapeCommand();
            const { doc } = wireCommand(cmd);
            seedStepDatas(cmd, [{ nodes: undefined } as any]);
            const root = doc.modelManager.rootNode as unknown as TrackingParent;

            expect(() => (cmd as any).executeMainTask()).not.toThrow();
            expect(root.added).toHaveLength(0);
        });

        test("should pass the configured tolerance through to each repair call", () => {
            const { cmd, shapes } = buildRepairCommand(1);
            cmd.tolerance = 1e-3;

            (cmd as any).executeMainTask();

            // setTolerance(tolerance) is the first call.
            expect(shapes[0].calls.get("setTolerance")![0][0]).toBe(1e-3);
            // shellSewing, fixShape, fixSmallFace all take tolerance as the first arg.
            expect(shapes[0].calls.get("shellSewing")![0][0]).toBe(1e-3);
            expect(shapes[0].calls.get("fixShape")![0][0]).toBe(1e-3);
            expect(shapes[0].calls.get("fixSmallFace")![0][0]).toBe(1e-3);
        });
    });
});
