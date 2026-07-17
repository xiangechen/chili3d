// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Dimensions, Matrix4, VisualConfig, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { Move } from "../../../src/commands/modify/move";
import {
    ensureGlobalStubApp,
    makeParent,
    pointStepResult,
    seedStepDatas,
    stubTransactionRun,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

/**
 * A node that records the last transform assigned to it. `Move.executeMainTask`
 * does `x.transform = x.transform.multiply(t)`; starting from identity the
 * assigned matrix equals the translation directly, so tests can assert it.
 */
function trackingNode(parent?: any) {
    const cloneHolder: any = { transform: undefined as unknown as Matrix4 };
    return {
        node: {
            parent,
            get transform() {
                return Matrix4.identity();
            },
            set transform(value: Matrix4) {
                (this as any)._assigned = value;
            },
            assigned(): Matrix4 {
                return (this as any)._assigned;
            },
            worldTransform() {
                return Matrix4.identity();
            },
            clone() {
                return cloneHolder;
            },
        },
        cloneHolder,
    };
}

describe("Move", () => {
    test("should have command metadata", () => {
        const data = (Move as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.move");
        expect(data.icon).toBe("icon-move");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Move();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function moveWithPoints(p1: XYZ, p2?: XYZ): Move {
        const cmd = new Move();
        wireCommand(cmd);
        seedStepDatas(cmd, [pointStepResult({ point: p1 }), pointStepResult({ point: p2 })]);
        return cmd;
    }

    describe("getSecondPointData", () => {
        test("should expose refPoint, D1D2D3 dimension, and a preview callback", () => {
            const p1 = new XYZ({ x: 1, y: 2, z: 3 });
            const cmd = moveWithPoints(p1);

            const data = (cmd as any).getSecondPointData();

            expect(data.refPoint()).toEqual(p1);
            expect(data.dimension).toBe(Dimensions.D1D2D3);
            expect(typeof data.preview).toBe("function");
        });
    });

    describe("movePreview", () => {
        test("should return only the first vertex when point is undefined", () => {
            const p1 = new XYZ({ x: 1, y: 2, z: 3 });
            const cmd = moveWithPoints(p1);

            const preview = (cmd as any).movePreview(undefined);

            expect(preview).toHaveLength(1);
            // meshPoint emits a vertex mesh at p1
            expect(Array.from(preview[0].position)).toEqual([1, 2, 3]);
        });

        test("should return [p1, transformedPreview, tempLine] when point is given", () => {
            const p1 = XYZ.zero;
            const cmd = moveWithPoints(p1, new XYZ({ x: 5, y: 0, z: 0 }));
            // seed positions so transformPreview has something to transform
            (cmd as any).positions = [0, 0, 0];

            const end = new XYZ({ x: 2, y: 0, z: 0 });
            const preview = (cmd as any).movePreview(end);

            expect(preview).toHaveLength(3);
            // [0] vertex at p1
            expect(Array.from(preview[0].position)).toEqual([0, 0, 0]);
            // [1] transformed positions: (0,0,0) translated by (2,0,0)
            expect(Array.from(preview[1].position)).toEqual([2, 0, 0]);
            // [2] temp line from p1 to end
            expect(Array.from(preview[2].position)).toEqual([0, 0, 0, 2, 0, 0]);
            expect(preview[2].color).toBe(VisualConfig.temporaryEdgeColor);
        });
    });

    describe("transfrom", () => {
        test("should build a translation by (point - stepDatas[0].point)", () => {
            const cmd = moveWithPoints(new XYZ({ x: 1, y: 1, z: 1 }));

            const m = (cmd as any).transfrom(new XYZ({ x: 4, y: 6, z: 9 }));

            // (4,6,9) - (1,1,1) = (3,5,8)
            const expected = Matrix4.fromTranslation(3, 5, 8);
            for (let i = 0; i < 16; i++) {
                expect(m.array[i]).toBeCloseTo(expected.array[i], 6);
            }
        });

        test("should produce identity when the point equals the first picked point", () => {
            const p1 = new XYZ({ x: 7, y: 8, z: 9 });
            const cmd = moveWithPoints(p1);

            const m = (cmd as any).transfrom(p1);

            const expected = Matrix4.fromTranslation(0, 0, 0);
            for (let i = 0; i < 16; i++) {
                expect(m.array[i]).toBeCloseTo(expected.array[i], 6);
            }
        });
    });

    describe("executeMainTask", () => {
        test("should move the model in place by the picked delta (isClone=false)", () => {
            const restore = stubTransactionRun();
            try {
                const cmd = new Move();
                const { node } = trackingNode();
                wireCommand(cmd);
                (cmd as any).models = [node];
                seedStepDatas(cmd, [
                    pointStepResult({ point: XYZ.zero }),
                    pointStepResult({ point: new XYZ({ x: 10, y: 20, z: 30 }) }),
                ]);

                (cmd as any).executeMainTask();

                const expected = Matrix4.fromTranslation(10, 20, 30);
                for (let i = 0; i < 16; i++) {
                    expect(node.assigned().array[i]).toBeCloseTo(expected.array[i], 6);
                }
            } finally {
                restore();
            }
        });

        test("should clone-and-insert when isClone=true", () => {
            const restore = stubTransactionRun();
            try {
                const cmd = new Move();
                cmd.isClone = true;
                const parent = makeParent({ id: "parent" });
                const { node, cloneHolder } = trackingNode(parent);
                wireCommand(cmd);
                (cmd as any).models = [node];
                seedStepDatas(cmd, [
                    pointStepResult({ point: XYZ.zero }),
                    pointStepResult({ point: new XYZ({ x: 1, y: 2, z: 3 }) }),
                ]);

                (cmd as any).executeMainTask();

                expect(parent.insertedAfter).toHaveLength(1);
                expect(parent.insertedAfter[0].target).toBe(node);
                expect(parent.insertedAfter[0].node).toBe(cloneHolder);
                const expected = Matrix4.fromTranslation(1, 2, 3);
                for (let i = 0; i < 16; i++) {
                    expect(cloneHolder.transform.array[i]).toBeCloseTo(expected.array[i], 6);
                }
            } finally {
                restore();
            }
        });
    });
});
