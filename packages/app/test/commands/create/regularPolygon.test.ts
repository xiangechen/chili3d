// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { RegularPolygonNode } from "../../../src/bodys";
import { RegularPolygon } from "../../../src/commands/create/regularPolygon";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("RegularPolygon", () => {
    test("should have command metadata", () => {
        const data = (RegularPolygon as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.regularPolygon");
        expect(data.icon).toBe("icon-polygon");
    });

    test("should extend CreateFaceableCommand", () => {
        const cmd = new RegularPolygon();
        expect(cmd.isFace).toBe(true);
    });

    test("sides should default to 6", () => {
        const cmd = new RegularPolygon();
        expect(cmd.sides).toBe(6);
    });

    test("sides setter should update property for valid values", () => {
        const cmd = new RegularPolygon();
        cmd.sides = 8;
        expect(cmd.sides).toBe(8);
    });

    test("sides setter should reject values less than 3", () => {
        const cmd = new RegularPolygon();
        cmd.sides = 8;
        cmd.sides = 2;
        expect(cmd.sides).toBe(8);
    });

    test("getSteps should return two steps", () => {
        const cmd = new RegularPolygon();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function regularPolygon(center: XYZ, radiusPick: XYZ): RegularPolygon {
        const cmd = new RegularPolygon();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: center }),
            pointStepResult({ point: radiusPick, plane: Plane.XY }),
        ]);
        return cmd;
    }

    describe("getRadiusData", () => {
        test("should expose point, preview, plane, and validator", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).getRadiusData();
            expect(typeof data.point).toBe("function");
            expect(typeof data.preview).toBe("function");
            expect(typeof data.plane).toBe("function");
            expect(typeof data.validator).toBe("function");
        });

        test("validator should reject coincident point", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).getRadiusData();
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("validator should reject point parallel to plane normal", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).getRadiusData();
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(new XYZ({ x: 0, y: 0, z: 5 }))).toBe(false);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("validator should accept a valid coplanar point", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).getRadiusData();
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(new XYZ({ x: 3, y: 0, z: 0 }))).toBe(true);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("geometryNode", () => {
        test("should build a RegularPolygonNode with default 6 sides", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(RegularPolygonNode);
            expect(node.radius).toBeCloseTo(5, 6);
            expect(node.sides).toBe(6);
            expect(node.isFace).toBe(true);
        });

        test("should build a polygon with custom sides", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 4, y: 0, z: 0 }));
            cmd.sides = 5;
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(RegularPolygonNode);
            expect(node.sides).toBe(5);
        });

        test("should respect isFace flag", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            cmd.isFace = false;
            const node = (cmd as any).geometryNode();
            expect(node.isFace).toBe(false);
        });
    });

    describe("polygonPreview", () => {
        test("should render only center vertex when end is undefined", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const preview = (cmd as any).polygonPreview(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render center, radius line, and polygon edges when end is given", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const preview = (cmd as any).polygonPreview(new XYZ({ x: 3, y: 0, z: 0 }));
                // center point + radius line + 6 edge lines (for hexagon)
                expect(preview.length).toBeGreaterThanOrEqual(3);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("should include center point in polygon preview", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const preview = (cmd as any).polygonPreview(new XYZ({ x: 5, y: 0, z: 0 }));
                // Polygon preview with non-zero radius produces center + radius line + edges
                expect(preview.length).toBeGreaterThanOrEqual(2);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("getPlane", () => {
        test("should return a plane with the correct normal", () => {
            const cmd = regularPolygon(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const plane = (cmd as any).getPlane(
                    new XYZ({ x: 0, y: 0, z: 0 }),
                    new XYZ({ x: 3, y: 0, z: 0 }),
                );
                expect(plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });
});
