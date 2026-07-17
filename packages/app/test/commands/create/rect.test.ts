// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { RectNode } from "../../../src/bodys/rect";
import { getReactData, Rect } from "../../../src/commands/create/rect";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("getReactData", () => {
    test("should compute rect data for axis-aligned plane", () => {
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const start = XYZ.zero;
        const end = new XYZ({ x: 10, y: 5, z: 0 });

        const result = getReactData(plane, start, end);

        expect(result.dx).toBeCloseTo(10);
        expect(result.dy).toBeCloseTo(5);
        expect(result.plane.origin.x).toBeCloseTo(0);
        expect(result.plane.origin.y).toBeCloseTo(0);
        expect(result.plane.origin.z).toBeCloseTo(0);
        expect(result.plane.normal.isEqualTo(plane.normal)).toBe(true);
    });

    test("should compute rect data for non-zero start point", () => {
        const normal = XYZ.unitZ;
        const xvec = XYZ.unitX;
        const plane = new Plane({ origin: new XYZ({ x: 2, y: 3, z: 0 }), normal, xvec });
        const start = new XYZ({ x: 2, y: 3, z: 0 });
        const end = new XYZ({ x: 8, y: 7, z: 0 });

        const result = getReactData(plane, start, end);

        expect(result.dx).toBeCloseTo(6);
        expect(result.dy).toBeCloseTo(4);
    });

    test("should compute negative dimensions", () => {
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const start = XYZ.zero;
        const end = new XYZ({ x: -5, y: -10, z: 0 });

        const result = getReactData(plane, start, end);

        expect(result.dx).toBeCloseTo(-5);
        expect(result.dy).toBeCloseTo(-10);
    });
});

describe("Rect", () => {
    test("should have command metadata", () => {
        const data = (Rect as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.rect");
        expect(data.icon).toBe("icon-rect");
    });

    test("isFace should default to true", () => {
        const cmd = new Rect();
        expect(cmd.isFace).toBe(true);
    });

    test("isFace setter should update property", () => {
        const cmd = new Rect();
        cmd.isFace = false;
        expect(cmd.isFace).toBe(false);
    });

    test("centerRect should default to false", () => {
        const cmd = new Rect();
        expect(cmd.centerRect).toBe(false);
    });

    test("centerRect setter should update property", () => {
        const cmd = new Rect();
        cmd.centerRect = true;
        expect(cmd.centerRect).toBe(true);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Rect();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    // disable dynamicWorkplane so rectDataFromTemp uses the static workplane
    // instead of raycasting through the (mocked) view camera.
    function withStaticWorkplane<T>(fn: () => T): T {
        const saved = Config.instance.dynamicWorkplane;
        Config.instance.dynamicWorkplane = false;
        try {
            return fn();
        } finally {
            Config.instance.dynamicWorkplane = saved;
        }
    }

    function rectCmd(start: XYZ, end: XYZ, opts: { type?: "input" | "feature"; plane?: Plane } = {}): Rect {
        const cmd = new Rect();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: start }),
            pointStepResult({ point: end, type: opts.type ?? "input", plane: opts.plane }),
        ]);
        return cmd;
    }

    describe("nextSnapData / handleValid", () => {
        test("handleValid should reject a coincident point (zero dx/dy)", () => {
            const origin = new XYZ({ x: 0, y: 0, z: 0 });
            const cmd = rectCmd(origin, new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).nextSnapData();

            withStaticWorkplane(() => {
                // coincident -> both dx,dy zero -> rejected
                expect(data.validator(origin)).toBe(false);
                // horizontal-only (dy=0) rejected by anyEqualZero
                expect(data.validator(new XYZ({ x: 3, y: 0, z: 0 }))).toBe(false);
                // proper rectangle accepted
                expect(data.validator(new XYZ({ x: 3, y: 4, z: 0 }))).toBe(true);
            });
        });

        test("prompt should format the current dx,dy", () => {
            const cmd = rectCmd(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 0, z: 0 }));
            const data = (cmd as any).nextSnapData();
            const text = withStaticWorkplane(() => data.prompt({ point: new XYZ({ x: 4, y: 2, z: 0 }) }));
            expect(text).toBe("4.00, 2.00");
        });
    });

    describe("rectDataFromTwoSteps", () => {
        test("should use the recorded plane when present", () => {
            const cmd = rectCmd(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 6, y: 0, z: 0 }), {
                plane: Plane.XY,
            });
            const data = (cmd as any).rectDataFromTwoSteps();
            expect(data.dx).toBeCloseTo(6, 6);
            expect(data.dy).toBeCloseTo(0, 6);
        });

        test("should fall back to rectDataFromTemp when no plane recorded", () => {
            const cmd = rectCmd(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 4, z: 0 }));
            const data = withStaticWorkplane(() => (cmd as any).rectDataFromTwoSteps());
            expect(data.dx).toBeCloseTo(3, 6);
            expect(data.dy).toBeCloseTo(4, 6);
        });
    });

    describe("geometryNode", () => {
        test("should build a RectNode from two corner picks", () => {
            const cmd = rectCmd(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 6, y: 8, z: 0 }), {
                plane: Plane.XY,
            });
            const node = (cmd as any).geometryNode();

            expect(node).toBeInstanceOf(RectNode);
            expect(node.dx).toBeCloseTo(6, 6);
            expect(node.dy).toBeCloseTo(8, 6);
            expect(node.isFace).toBe(true);
        });

        test("should honor isFace=false", () => {
            const cmd = rectCmd(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 2, y: 2, z: 0 }), {
                plane: Plane.XY,
            });
            cmd.isFace = false;
            const node = (cmd as any).geometryNode();
            expect(node.isFace).toBe(false);
        });
    });

    describe("centerRect", () => {
        test("should keep dx/dy when the second step is an input (no doubling)", () => {
            const cmd = rectCmd(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 3, z: 0 }), {
                type: "input",
                plane: Plane.XY,
            });
            cmd.centerRect = true;
            const data = (cmd as any).rectDataFromTwoSteps();
            // input type + centerRect: dx/dy unchanged, origin shifted to center
            expect(data.dx).toBeCloseTo(5, 6);
            expect(data.dy).toBeCloseTo(3, 6);
        });

        test("should double dx/dy for a non-input (feature) second step", () => {
            const cmd = rectCmd(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 3, z: 0 }), {
                type: "feature",
                plane: Plane.XY,
            });
            cmd.centerRect = true;
            const data = (cmd as any).rectDataFromTwoSteps();
            // feature + centerRect: dx/dy doubled so the pick is the half-extent
            expect(data.dx).toBeCloseTo(10, 6);
            expect(data.dy).toBeCloseTo(6, 6);
        });

        test("should be a no-op when centerRect is false", () => {
            const cmd = rectCmd(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 3, z: 0 }), {
                type: "feature",
                plane: Plane.XY,
            });
            // centerRect defaults to false -> no doubling
            const data = (cmd as any).rectDataFromTwoSteps();
            expect(data.dx).toBeCloseTo(5, 6);
            expect(data.dy).toBeCloseTo(3, 6);
        });
    });
});
