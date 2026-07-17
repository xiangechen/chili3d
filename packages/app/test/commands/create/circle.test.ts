// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { CircleNode } from "../../../src/bodys/circle";
import { Circle } from "../../../src/commands/create/circle";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Circle", () => {
    test("should have command metadata", () => {
        const data = (Circle as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.circle");
        expect(data.icon).toBe("icon-circle");
    });

    test("should extend CreateFaceableCommand", () => {
        const cmd = new Circle();
        expect(cmd.isFace).toBe(true);
    });

    test("getSteps should return two steps (center + radius)", () => {
        const cmd = new Circle();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    test("isFace setter should update property", () => {
        const cmd = new Circle();
        cmd.isFace = false;
        expect(cmd.isFace).toBe(false);
        cmd.isFace = true;
        expect(cmd.isFace).toBe(true);
    });

    function circleFromPoints(center: XYZ, radiusPick: XYZ, plane?: Plane): Circle {
        const cmd = new Circle();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: center }),
            pointStepResult({ point: radiusPick, plane: plane ?? Plane.XY }),
        ]);
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build a CircleNode whose radius is the in-plane distance", () => {
            const cmd = circleFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 3, y: 4, z: 0 }), // distance 5 in XY plane
            );
            const node = (cmd as any).geometryNode();

            expect(node).toBeInstanceOf(CircleNode);
            expect(node.radius).toBeCloseTo(5, 6);
            expect(node.center.isEqualTo(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(true);
            expect(node.isFace).toBe(true);
        });

        test("should respect the isFace flag when building the node", () => {
            const cmd = circleFromPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 2, y: 0, z: 0 }));
            cmd.isFace = false;
            const node = (cmd as any).geometryNode();
            expect(node.isFace).toBe(false);
        });

        test("should derive the normal from the recorded plane", () => {
            const cmd = circleFromPoints(
                new XYZ({ x: 1, y: 1, z: 0 }),
                new XYZ({ x: 6, y: 1, z: 0 }), // radius 5 along +X in XY plane
            );
            const node = (cmd as any).geometryNode();
            expect(node.normal.isEqualTo(Plane.XY.normal)).toBe(true);
            expect(node.radius).toBeCloseTo(5, 6);
        });
    });

    describe("getRadiusData", () => {
        test("validator should reject a coincident point and accept a coplanar one", () => {
            const center = new XYZ({ x: 0, y: 0, z: 0 });
            const cmd = circleFromPoints(center, new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).getRadiusData();

            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                // coincident -> distance < Precision -> rejected
                expect(data.validator(center)).toBe(false);
                // coplanar offset -> accepted
                expect(data.validator(new XYZ({ x: 3, y: 0, z: 0 }))).toBe(true);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("validator should reject a pick parallel to the plane normal (degenerate radius)", () => {
            const cmd = circleFromPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).getRadiusData();

            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                // point directly above center along the plane normal (+Z): the
                // radius vector is parallel to the normal -> rejected.
                expect(data.validator(new XYZ({ x: 0, y: 0, z: 5 }))).toBe(false);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("circlePreview", () => {
        test("should render only the center vertex when end is undefined", () => {
            const cmd = circleFromPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const preview = (cmd as any).circlePreview(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render center, radius line and circle mesh when end is given", () => {
            const cmd = circleFromPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const preview = (cmd as any).circlePreview(new XYZ({ x: 3, y: 0, z: 0 }));
                // [meshPoint(center), meshLine(center,end), meshCreatedShape(circle,...)]
                expect(preview).toHaveLength(3);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });
});
