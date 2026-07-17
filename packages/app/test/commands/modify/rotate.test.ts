// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Dimensions, Matrix4, type Plane, Precision, VisualConfig, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { Rotate } from "../../../src/commands/modify/rotate";
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
let savedDynamic: boolean;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
    // disable dynamic workplane so findPlane returns view.workplane translated
    // to the origin point (deterministic, no raycast needed).
    savedDynamic = Config.instance.dynamicWorkplane;
    Config.instance.dynamicWorkplane = false;
});
afterAll(() => {
    restoreApp();
    Config.instance.dynamicWorkplane = savedDynamic;
});

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

describe("Rotate", () => {
    test("should have command metadata", () => {
        const data = (Rotate as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.rotate");
        expect(data.icon).toBe("icon-rotate");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Rotate();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    /**
     * Seed a Rotate command ready for preview/validator/transform calls.
     * Center at origin, second point at (1,0,0) on the XY plane, third point
     * at (0,1,0) — a 90° CCW rotation about +Z.
     */
    function rotateCmd(opts: { center?: XYZ; second?: XYZ; third?: XYZ; plane?: Plane } = {}): Rotate {
        const cmd = new Rotate();
        wireCommand(cmd);
        const center = opts.center ?? XYZ.zero;
        const second = opts.second ?? new XYZ({ x: 1, y: 0, z: 0 });
        const plane = opts.plane ?? PLANE_XY;
        seedStepDatas(cmd, [
            pointStepResult({ point: center }),
            pointStepResult({ point: second, plane }),
            pointStepResult({ point: opts.third ?? new XYZ({ x: 0, y: 1, z: 0 }) }),
        ]);
        return cmd;
    }

    describe("getSecondPointData", () => {
        test("should expose point, preview, plane callback, and validator", () => {
            const center = XYZ.zero;
            const cmd = rotateCmd({ center });

            const data = (cmd as any).getSecondPointData();

            expect(data.point()).toEqual(center);
            expect(typeof data.preview).toBe("function");
            expect(typeof data.plane).toBe("function");
            expect(typeof data.validator).toBe("function");
            // plane callback returns the workplane translated to the center
            const plane = data.plane(undefined);
            expect(plane.normal.isEqualTo(PLANE_XY.normal)).toBe(true);
        });

        test("validator should reject a point coincident with the center", () => {
            const center = new XYZ({ x: 1, y: 1, z: 1 });
            const cmd = rotateCmd({ center });
            const data = (cmd as any).getSecondPointData();

            expect(data.validator(center)).toBe(false);
        });

        test("validator should reject a point along the workplane normal", () => {
            const center = XYZ.zero;
            const cmd = rotateCmd({ center });
            const data = (cmd as any).getSecondPointData();
            // (0,0,5) - (0,0,0) is parallel to the XY-plane normal (0,0,1)
            const alongNormal = new XYZ({ x: 0, y: 0, z: 5 });

            expect(data.validator(alongNormal)).toBe(false);
        });

        test("validator should accept a non-parallel, non-coincident point", () => {
            const center = XYZ.zero;
            const cmd = rotateCmd({ center });
            const data = (cmd as any).getSecondPointData();

            expect(data.validator(new XYZ({ x: 3, y: 4, z: 0 }))).toBe(true);
        });
    });

    describe("circlePreview", () => {
        test("should return just the center vertex when end is undefined", () => {
            const cmd = rotateCmd({ center: new XYZ({ x: 2, y: 2, z: 0 }) });

            const preview = (cmd as any).circlePreview(undefined);

            expect(preview).toHaveLength(1);
            expect(Array.from(preview[0].position)).toEqual([2, 2, 0]);
        });

        test("should return [center, line, circle-shape] when end is given", () => {
            const cmd = rotateCmd({ center: XYZ.zero });

            const preview = (cmd as any).circlePreview(new XYZ({ x: 2, y: 0, z: 0 }));

            expect(preview).toHaveLength(3);
            // [0] center vertex
            expect(Array.from(preview[0].position)).toEqual([0, 0, 0]);
            // [1] line from center to end
            expect(Array.from(preview[1].position)).toEqual([0, 0, 0, 2, 0, 0]);
            // [2] circle shape mesh (stub factory returns an edges-mesh shape)
            expect(preview[2]).toBeDefined();
            expect(preview[2].type).toBe("edges");
        });
    });

    describe("getThirdPointData", () => {
        test("should expose D1D2 dimension, preview, plane, and validator", () => {
            const cmd = rotateCmd();

            const data = (cmd as any).getThirdPointData();

            expect(data.dimension).toBe(Dimensions.D1D2);
            expect(typeof data.preview).toBe("function");
            expect(data.plane()).toBe(PLANE_XY);
            expect(typeof data.validator).toBe("function");
        });

        test("validator should reject a point too close to the center", () => {
            const cmd = rotateCmd({ center: XYZ.zero, second: new XYZ({ x: 1, y: 0, z: 0 }) });
            const data = (cmd as any).getThirdPointData();

            expect(data.validator(new XYZ({ x: 1e-5, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should reject a point too close to the second point", () => {
            const cmd = rotateCmd({ center: XYZ.zero, second: new XYZ({ x: 1, y: 0, z: 0 }) });
            const data = (cmd as any).getThirdPointData();

            expect(data.validator(new XYZ({ x: 1.00001, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should accept a point away from both the center and second point", () => {
            const cmd = rotateCmd({ center: XYZ.zero, second: new XYZ({ x: 1, y: 0, z: 0 }) });
            const data = (cmd as any).getThirdPointData();

            expect(data.validator(new XYZ({ x: 0, y: 1, z: 0 }))).toBe(true);
        });
    });

    describe("getAngle", () => {
        test("should return the signed angle from the second ray to the target on the plane", () => {
            const cmd = rotateCmd({
                center: XYZ.zero,
                second: new XYZ({ x: 1, y: 0, z: 0 }),
            });

            // 90° CCW about +Z: from +X to +Y
            const angle = (cmd as any).getAngle(new XYZ({ x: 0, y: 1, z: 0 }));
            expect(angle).toBeCloseTo(Math.PI / 2, 6);
        });

        test("should return ~0 when the target lies on the second ray", () => {
            const cmd = rotateCmd({
                center: XYZ.zero,
                second: new XYZ({ x: 1, y: 0, z: 0 }),
            });

            const angle = (cmd as any).getAngle(new XYZ({ x: 5, y: 0, z: 0 }));
            expect(Math.abs(angle)).toBeLessThan(1e-6);
        });
    });

    describe("anglePreview", () => {
        test("should fall back to the second stepData point when no point is passed (no arc)", () => {
            const cmd = rotateCmd({
                center: XYZ.zero,
                second: new XYZ({ x: 1, y: 0, z: 0 }),
                third: new XYZ({ x: 0, y: 1, z: 0 }),
            });
            (cmd as any).positions = [0, 0, 0];

            const preview = (cmd as any).anglePreview(undefined);

            // anglePreview falls back to stepDatas[1].point, so angle ~0 and no arc.
            // [transformedPreview, center vertex, second vertex, ray, ray]
            expect(preview.length).toBe(5);
        });

        test("should include the arc mesh only when the angle exceeds Precision.Angle", () => {
            const cmd = rotateCmd({
                center: XYZ.zero,
                second: new XYZ({ x: 1, y: 0, z: 0 }),
            });
            (cmd as any).positions = [0, 0, 0];

            // large angle (90°) → arc present
            const withArc = (cmd as any).anglePreview(new XYZ({ x: 0, y: 1, z: 0 }));
            expect(withArc.length).toBe(6);
            // the last element is the arc shape mesh (stub factory edges-mesh)
            expect(withArc[5]).toBeDefined();
            expect(withArc[5].type).toBe("edges");
        });

        test("should omit the arc mesh when the angle is below Precision.Angle", () => {
            const cmd = rotateCmd({
                center: XYZ.zero,
                second: new XYZ({ x: 1, y: 0, z: 0 }),
            });
            (cmd as any).positions = [0, 0, 0];

            // target on the same ray → angle ~0, below Precision.Angle
            const noArc = (cmd as any).anglePreview(new XYZ({ x: 5, y: 0, z: 0 }));
            expect(noArc.length).toBe(5);
        });
    });

    describe("getRayData", () => {
        test("should build a long edge from the center along the end direction", () => {
            const cmd = rotateCmd({ center: XYZ.zero });

            const ray = (cmd as any).getRayData(new XYZ({ x: 1, y: 0, z: 0 }));

            // starts at center, extends 1e6 along +X
            expect(Array.from(ray.position)).toEqual([0, 0, 0, 1e6, 0, 0]);
            expect(ray.color).toBe(VisualConfig.temporaryEdgeColor);
        });
    });

    describe("transfrom", () => {
        test("should build an axis rotation about the plane normal through the center", () => {
            const cmd = rotateCmd({
                center: XYZ.zero,
                second: new XYZ({ x: 1, y: 0, z: 0 }),
                third: new XYZ({ x: 0, y: 1, z: 0 }),
            });

            const m = (cmd as any).transfrom(new XYZ({ x: 0, y: 1, z: 0 }));

            const expected = Matrix4.fromAxisRad(XYZ.zero, PLANE_XY.normal, Math.PI / 2);
            for (let i = 0; i < 16; i++) {
                expect(m.array[i]).toBeCloseTo(expected.array[i], 6);
            }
        });
    });

    describe("executeMainTask", () => {
        test("should rotate the model in place (isClone=false)", () => {
            const restore = stubTransactionRun();
            try {
                const cmd = new Rotate();
                const { node } = trackingNode();
                wireCommand(cmd);
                (cmd as any).models = [node];
                seedStepDatas(cmd, [
                    pointStepResult({ point: XYZ.zero }),
                    pointStepResult({ point: new XYZ({ x: 1, y: 0, z: 0 }), plane: PLANE_XY }),
                    pointStepResult({ point: new XYZ({ x: 0, y: 1, z: 0 }) }),
                ]);

                (cmd as any).executeMainTask();

                const expected = Matrix4.fromAxisRad(XYZ.zero, PLANE_XY.normal, Math.PI / 2);
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
                const cmd = new Rotate();
                cmd.isClone = true;
                const parent = makeParent({ id: "parent" });
                const { node, cloneHolder } = trackingNode(parent);
                wireCommand(cmd);
                (cmd as any).models = [node];
                seedStepDatas(cmd, [
                    pointStepResult({ point: XYZ.zero }),
                    pointStepResult({ point: new XYZ({ x: 1, y: 0, z: 0 }), plane: PLANE_XY }),
                    pointStepResult({ point: new XYZ({ x: 0, y: 1, z: 0 }) }),
                ]);

                (cmd as any).executeMainTask();

                expect(parent.insertedAfter).toHaveLength(1);
                expect(parent.insertedAfter[0].target).toBe(node);
                expect(parent.insertedAfter[0].node).toBe(cloneHolder);
                const expected = Matrix4.fromAxisRad(XYZ.zero, PLANE_XY.normal, Math.PI / 2);
                for (let i = 0; i < 16; i++) {
                    expect(cloneHolder.transform.array[i]).toBeCloseTo(expected.array[i], 6);
                }
            } finally {
                restore();
            }
        });
    });
});
