// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Dimensions, Matrix4, Plane, VisualConfig, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { Mirror } from "../../../src/commands/modify/mirror";
import {
    ensureGlobalStubApp,
    makeParent,
    PLANE_XY,
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

/** A node that records the last transform assigned to it. */
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

describe("Mirror", () => {
    test("should have command metadata", () => {
        const data = (Mirror as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.mirror");
        expect(data.icon).toBe("icon-mirror");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Mirror();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function mirrorWithPoints(p1: XYZ, p2?: XYZ): Mirror {
        const cmd = new Mirror();
        wireCommand(cmd);
        seedStepDatas(cmd, [pointStepResult({ point: p1 }), pointStepResult({ point: p2 })]);
        return cmd;
    }

    describe("getSecondPointData", () => {
        test("should expose refPoint, D1D2 dimension, preview, and validator", () => {
            const p1 = new XYZ({ x: 1, y: 1, z: 1 });
            const cmd = mirrorWithPoints(p1);

            const data = (cmd as any).getSecondPointData();

            expect(data.refPoint()).toEqual(p1);
            expect(data.dimension).toBe(Dimensions.D1D2);
            expect(typeof data.preview).toBe("function");
            expect(typeof data.validator).toBe("function");
        });

        test("validator should reject a point coincident with the first point", () => {
            const p1 = new XYZ({ x: 2, y: 2, z: 0 });
            const cmd = mirrorWithPoints(p1);
            const data = (cmd as any).getSecondPointData();

            expect(data.validator(p1)).toBe(false);
        });

        test("validator should reject a point whose vector is parallel to the workplane normal", () => {
            const p1 = XYZ.zero;
            const cmd = mirrorWithPoints(p1);
            const data = (cmd as any).getSecondPointData();
            // (0,0,3) - (0,0,0) is parallel to the XY-plane normal (0,0,1)
            const alongNormal = new XYZ({ x: 0, y: 0, z: 3 });

            expect(data.validator(alongNormal)).toBe(false);
        });

        test("validator should accept a non-parallel, non-coincident point", () => {
            const p1 = XYZ.zero;
            const cmd = mirrorWithPoints(p1);
            const data = (cmd as any).getSecondPointData();

            expect(data.validator(new XYZ({ x: 1, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("mirrorPreview", () => {
        test("should return only the first vertex when point is undefined", () => {
            const p1 = new XYZ({ x: 3, y: 4, z: 5 });
            const cmd = mirrorWithPoints(p1);

            const preview = (cmd as any).mirrorPreview(undefined);

            expect(preview).toHaveLength(1);
            expect(Array.from(preview[0].position)).toEqual([3, 4, 5]);
        });

        test("should return [p1, transformedShape, mirrorLine] when point is given", () => {
            const p1 = XYZ.zero;
            const cmd = mirrorWithPoints(p1, new XYZ({ x: 1, y: 0, z: 0 }));
            // seed positions so transformPreview has data to transform
            (cmd as any).positions = [0, 0, 0];

            const end = new XYZ({ x: 1, y: 0, z: 0 });
            const preview = (cmd as any).mirrorPreview(end);

            expect(preview).toHaveLength(3);
            // [0] vertex at p1
            expect(Array.from(preview[0].position)).toEqual([0, 0, 0]);
            // [1] transformed preview shape (mirrored positions)
            expect(preview[1]).toBeDefined();
            // [2] mirror line through p1 along the mirror direction (temp edge color)
            expect(preview[2].color).toBe(VisualConfig.temporaryEdgeColor);
            // line endpoints: p1 - offset and end + offset, where offset = unit(1,0,0)*1e6
            expect(Array.from(preview[2].position)).toEqual([-1e6, 0, 0, 1e6 + 1, 0, 0]);
        });

        test("mirror line should extend through the picked point when p1 is off-origin", () => {
            const p1 = new XYZ({ x: 5, y: 5, z: 0 });
            const cmd = mirrorWithPoints(p1);
            (cmd as any).positions = [0, 0, 0];

            // mirror direction along +Y
            const end = new XYZ({ x: 5, y: 6, z: 0 });
            const preview = (cmd as any).mirrorPreview(end);

            expect(preview).toHaveLength(3);
            // offset = (0,1,0)*1e6; line = (p1 - offset) → (end + offset)
            expect(Array.from(preview[2].position)).toEqual([5, 5 - 1e6, 0, 5, 6 + 1e6, 0]);
        });
    });

    describe("transfrom", () => {
        test("should build a mirror matrix from the plane (center, xvec=normal, yvec=point-center)", () => {
            const p1 = XYZ.zero;
            const cmd = mirrorWithPoints(p1);

            const m = (cmd as any).transfrom(new XYZ({ x: 1, y: 0, z: 0 }));

            // plane: origin=(0,0,0), xvec=workplane.normal=(0,0,1),
            //        yvec=(1,0,0), normal = yvec cross xvec = (0,-1,0)
            const expected = Matrix4.createMirrorWithPlane(
                new Plane({
                    origin: XYZ.zero,
                    normal: new XYZ({ x: 0, y: -1, z: 0 }),
                    xvec: PLANE_XY.normal,
                }),
            );
            for (let i = 0; i < 16; i++) {
                expect(m.array[i]).toBeCloseTo(expected.array[i], 6);
            }
        });

        test("should mirror across a plane anchored at a non-origin center", () => {
            const p1 = new XYZ({ x: 2, y: 2, z: 0 });
            const cmd = mirrorWithPoints(p1);

            const m = (cmd as any).transfrom(new XYZ({ x: 3, y: 2, z: 0 }));

            // yvec = (1,0,0), normal = (1,0,0) cross (0,0,1) = (0,1,0)
            const expected = Matrix4.createMirrorWithPlane(
                new Plane({
                    origin: p1,
                    normal: new XYZ({ x: 0, y: 1, z: 0 }),
                    xvec: PLANE_XY.normal,
                }),
            );
            for (let i = 0; i < 16; i++) {
                expect(m.array[i]).toBeCloseTo(expected.array[i], 6);
            }
        });
    });

    describe("executeMainTask", () => {
        test("should mirror the model in place (isClone=false)", () => {
            const restore = stubTransactionRun();
            try {
                const cmd = new Mirror();
                const { node } = trackingNode();
                wireCommand(cmd);
                (cmd as any).models = [node];
                seedStepDatas(cmd, [
                    pointStepResult({ point: XYZ.zero }),
                    pointStepResult({ point: new XYZ({ x: 1, y: 0, z: 0 }) }),
                ]);

                (cmd as any).executeMainTask();

                const expected = Matrix4.createMirrorWithPlane(
                    new Plane({
                        origin: XYZ.zero,
                        normal: new XYZ({ x: 0, y: -1, z: 0 }),
                        xvec: PLANE_XY.normal,
                    }),
                );
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
                const cmd = new Mirror();
                cmd.isClone = true;
                const parent = makeParent({ id: "parent" });
                const { node, cloneHolder } = trackingNode(parent);
                wireCommand(cmd);
                (cmd as any).models = [node];
                seedStepDatas(cmd, [
                    pointStepResult({ point: XYZ.zero }),
                    pointStepResult({ point: new XYZ({ x: 1, y: 0, z: 0 }) }),
                ]);

                (cmd as any).executeMainTask();

                expect(parent.insertedAfter).toHaveLength(1);
                expect(parent.insertedAfter[0].target).toBe(node);
                expect(parent.insertedAfter[0].node).toBe(cloneHolder);
                const expected = Matrix4.createMirrorWithPlane(
                    new Plane({
                        origin: XYZ.zero,
                        normal: new XYZ({ x: 0, y: -1, z: 0 }),
                        xvec: PLANE_XY.normal,
                    }),
                );
                for (let i = 0; i < 16; i++) {
                    expect(cloneHolder.transform.array[i]).toBeCloseTo(expected.array[i], 6);
                }
            } finally {
                restore();
            }
        });
    });
});
