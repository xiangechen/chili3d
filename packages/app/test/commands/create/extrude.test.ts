// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, ShapeTypes, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { ExtrudeNode } from "../../../src/bodys/extrude";
import { ExtrudeCommand } from "../../../src/commands/create/extrude";
import {
    ensureGlobalStubApp,
    pointStepResult,
    seedStepDatas,
    shapeStepResult,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("ExtrudeCommand", () => {
    test("should have command metadata", () => {
        const data = (ExtrudeCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.extrude");
        expect(data.icon).toBe("icon-prism");
    });

    test("getSteps should return two steps", () => {
        const cmd = new ExtrudeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("geometryNode", () => {
        test("should build an ExtrudeNode whose length is the signed projection of the picked point", () => {
            // Face on the XY plane: normal() returns [point, +Z].
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.face,
                            normal: () => [XYZ.zero, XYZ.unitZ],
                        } as Partial<IShape>,
                        point: XYZ.zero,
                    },
                ]),
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 5 }) }),
            ]);

            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(ExtrudeNode);
            expect(node.length).toBeCloseTo(5, 6);
        });

        test("should produce a negative length when the picked point is below the section plane", () => {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.face,
                            normal: () => [XYZ.zero, XYZ.unitZ],
                        } as Partial<IShape>,
                        point: XYZ.zero,
                    },
                ]),
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: -3 }) }),
            ]);

            const node = (cmd as any).geometryNode();
            expect(node.length).toBeCloseTo(-3, 6);
        });
    });

    describe("getLengthStepData", () => {
        function buildFaceCommand(planar: boolean, surface?: () => unknown) {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            const shapeOverride: any = {
                shapeType: ShapeTypes.face,
                normal: () => [XYZ.zero, XYZ.unitZ],
            };
            if (surface) {
                shapeOverride.surface = surface;
            }
            seedStepDatas(cmd, [shapeStepResult([{ shape: shapeOverride, point: XYZ.zero }])]);
            return cmd;
        }

        test("should expose a point and a direction equal to the face normal", () => {
            const cmd = buildFaceCommand(true);
            const data = (cmd as any).getLengthStepData();
            expect(data.point.isEqualTo(XYZ.zero)).toBe(true);
            expect(data.direction.isEqualTo(XYZ.unitZ)).toBe(true);
            expect(typeof data.preview).toBe("function");
        });

        test("preview should return [] when point is undefined", () => {
            const cmd = buildFaceCommand(true);
            const data = (cmd as any).getLengthStepData();
            expect(data.preview(undefined)).toEqual([]);
        });

        test("preview should return [] when the distance is below float precision", () => {
            const cmd = buildFaceCommand(true);
            const data = (cmd as any).getLengthStepData();
            // point essentially on the section plane → dist ≈ 0
            expect(data.preview(new XYZ({ x: 1, y: 2, z: 0 }))).toEqual([]);
        });

        test("preview of a planar face should mesh a prism", () => {
            const cmd = buildFaceCommand(true, () => ({ isPlanar: () => true }));
            const data = (cmd as any).getLengthStepData();
            const preview = data.preview(new XYZ({ x: 0, y: 0, z: 4 }));
            expect(Array.isArray(preview)).toBe(true);
            expect(preview).toHaveLength(1);
        });

        test("preview of a non-planar face should mesh a thick solid", () => {
            const cmd = buildFaceCommand(false, () => ({ isPlanar: () => false }));
            const data = (cmd as any).getLengthStepData();
            const preview = data.preview(new XYZ({ x: 0, y: 0, z: 4 }));
            expect(Array.isArray(preview)).toBe(true);
            expect(preview).toHaveLength(1);
        });

        test("preview of an edge section should mesh a prism (no surface branch)", () => {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            // An edge whose curve normal is +Z (vec parallel to X → cross gives Z).
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.edge,
                            curve: {
                                basisCurve: { axis: undefined, dn: () => XYZ.unitX, direction: undefined },
                            },
                        } as Partial<IShape>,
                        point: XYZ.zero,
                    },
                ]),
            ]);
            const data = (cmd as any).getLengthStepData();
            const preview = data.preview(new XYZ({ x: 0, y: 0, z: 2 }));
            expect(Array.isArray(preview)).toBe(true);
            expect(preview).toHaveLength(1);
        });
    });
});
