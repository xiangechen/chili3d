// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { EllipseNode } from "../../../src/bodys/ellipse";
import { Ellipse } from "../../../src/commands/create/ellipse";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Ellipse", () => {
    test("should have command metadata", () => {
        const data = (Ellipse as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.ellipse");
        expect(data.icon).toBe("icon-ellipse");
    });

    test("should extend CreateFaceableCommand", () => {
        const cmd = new Ellipse();
        expect(cmd.isFace).toBe(true);
    });

    test("getSteps should return three steps", () => {
        const cmd = new Ellipse();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    test("isFace setter should update property", () => {
        const cmd = new Ellipse();
        cmd.isFace = false;
        expect(cmd.isFace).toBe(false);
        cmd.isFace = true;
        expect(cmd.isFace).toBe(true);
    });

    function ellipseFromPoints(center: XYZ, radius1Pick: XYZ, radius2Pick: XYZ): Ellipse {
        const cmd = new Ellipse();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: center }),
            pointStepResult({ point: radius1Pick, plane: Plane.XY }),
            pointStepResult({ point: radius2Pick }),
        ]);
        return cmd;
    }

    describe("getRadius1Data", () => {
        test("should expose point, preview, plane, and validator", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const data = (cmd as any).getRadius1Data();
            expect(typeof data.point).toBe("function");
            expect(typeof data.preview).toBe("function");
            expect(typeof data.plane).toBe("function");
            expect(typeof data.validator).toBe("function");
        });

        test("validator should reject coincident point with center", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const data = (cmd as any).getRadius1Data();
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("validator should reject point parallel to plane normal", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const data = (cmd as any).getRadius1Data();
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(new XYZ({ x: 0, y: 0, z: 5 }))).toBe(false);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("validator should accept a valid coplanar point", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const data = (cmd as any).getRadius1Data();
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(new XYZ({ x: 3, y: 0, z: 0 }))).toBe(true);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("getRadius2Data", () => {
        test("should expose point, preview, direction, and validator", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const data = (cmd as any).getRadius2Data();
            expect(typeof data.point).toBe("object");
            expect(typeof data.preview).toBe("function");
            expect(typeof data.direction).toBe("object");
            expect(typeof data.validator).toBe("function");
        });
    });

    describe("previewCircle", () => {
        test("should render only the center vertex when end is undefined", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const preview = (cmd as any).previewCircle(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render center, radius point, and circle mesh when end is given", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const preview = (cmd as any).previewCircle(new XYZ({ x: 3, y: 0, z: 0 }));
                expect(preview).toHaveLength(3);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("ellipsePreview", () => {
        test("should fall back to circlePreview when point is undefined", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const preview = (cmd as any).ellipsePreview(undefined);
            expect(preview).toHaveLength(3);
        });

        test("should render center, radius1 point, and ellipse mesh when point is given", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const preview = (cmd as any).ellipsePreview(new XYZ({ x: 0, y: 3, z: 0 }));
            expect(preview).toHaveLength(3);
        });
    });

    describe("geometryNode", () => {
        test("should build an EllipseNode with major and minor radii", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(EllipseNode);
            expect(node.majorRadius).toBeCloseTo(5, 6);
            expect(node.minorRadius).toBeCloseTo(3, 6);
            expect(node.isFace).toBe(true);
        });

        test("should clamp minor radius to major radius when minor > major", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 3, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(EllipseNode);
            expect(node.majorRadius).toBeCloseTo(3, 6);
            // minor radius (5) should be clamped to major radius (3)
            expect(node.minorRadius).toBeCloseTo(3, 6);
        });

        test("should respect isFace flag", () => {
            const cmd = ellipseFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 3, z: 0 }),
            );
            cmd.isFace = false;
            const node = (cmd as any).geometryNode();
            expect(node.isFace).toBe(false);
        });
    });
});
