// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, ShapeTypes, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { RevolvedNode } from "../../../src/bodys/revolve";
import { Revolve } from "../../../src/commands/create/revolve";
import {
    ensureGlobalStubApp,
    seedStepDatas,
    shapeData,
    shapeStepResult,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Revolve", () => {
    test("should have command metadata", () => {
        const data = (Revolve as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.revol");
        expect(data.icon).toBe("icon-revolve");
    });

    test("angle should default to 360", () => {
        const cmd = new Revolve();
        expect(cmd.angle).toBe(360);
    });

    test("angle setter should update property", () => {
        const cmd = new Revolve();
        cmd.angle = 180;
        expect(cmd.angle).toBe(180);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Revolve();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("geometryNode", () => {
        test("should build a RevolvedNode from a section profile and a line axis", () => {
            const cmd = new Revolve();
            wireCommand(cmd);
            // section profile (a face on the XY plane).
            const sectionShape = {
                shapeType: ShapeTypes.face,
                normal: () => [XYZ.zero, XYZ.unitZ],
            };
            // axis edge: an edge whose curve.basisCurve is a line passing through
            // the origin with direction +Z. value(0) returns the origin.
            const axisEdge = {
                shapeType: ShapeTypes.edge,
                curve: {
                    basisCurve: {
                        direction: XYZ.unitZ,
                        value: () => XYZ.zero,
                    },
                },
            };
            const transform = Matrix4.identity();
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: sectionShape, point: XYZ.zero }]),
                {
                    type: "shape" as const,
                    shapes: [shapeData({ shape: axisEdge, point: XYZ.zero, transform })],
                } as any,
            ]);

            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(RevolvedNode);
            expect(node.angle).toBe(360);
            // axis anchored at the origin, pointing along +Z
            expect(node.axis.point.isEqualTo(XYZ.zero)).toBe(true);
            expect(node.axis.direction.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should honor a custom angle set on the command", () => {
            const cmd = new Revolve();
            cmd.angle = 90;
            wireCommand(cmd);
            const sectionShape = {
                shapeType: ShapeTypes.face,
                normal: () => [XYZ.zero, XYZ.unitZ],
            };
            const axisEdge = {
                shapeType: ShapeTypes.edge,
                curve: { basisCurve: { direction: XYZ.unitZ, value: () => XYZ.zero } },
            };
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: sectionShape, point: XYZ.zero }]),
                {
                    type: "shape" as const,
                    shapes: [shapeData({ shape: axisEdge, point: XYZ.zero })],
                } as any,
            ]);

            const node = (cmd as any).geometryNode();
            expect(node.angle).toBe(90);
        });
    });

    describe("LineFilter", () => {
        function getFilter() {
            const cmd = new Revolve();
            const steps = (cmd as any).getSteps();
            // The second step carries the LineFilter via options.shapeFilter.
            return steps[1].options.shapeFilter;
        }

        test("should allow an edge whose basis curve is a line", () => {
            const filter = getFilter();
            const lineEdge = {
                shapeType: ShapeTypes.edge,
                curve: { basisCurve: { direction: XYZ.unitZ } },
            };
            expect(filter.allow(lineEdge)).toBe(true);
        });

        test("should reject an edge whose basis curve is not a line", () => {
            const filter = getFilter();
            const circleEdge = {
                shapeType: ShapeTypes.edge,
                curve: { basisCurve: { center: XYZ.zero, radius: 1 } },
            };
            expect(filter.allow(circleEdge)).toBe(false);
        });

        test("should reject non-edge shapes", () => {
            const filter = getFilter();
            expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(false);
            expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(false);
        });
    });

    describe("getSteps callbacks", () => {
        test("the axis step should carry beforeSelection/afterSelection that update highlight state", () => {
            const cmd = new Revolve();
            const { doc } = wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, point: XYZ.zero }]),
            ]);

            const steps = (cmd as any).getSteps();
            const opts = steps[1].options;
            expect(() => opts.beforeSelection()).not.toThrow();
            expect(() => opts.afterSelection()).not.toThrow();
            expect((doc.visual.highlighter.addState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            expect((doc.visual.highlighter.removeState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
