// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeTypes, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { SweepedNode } from "../../../src/bodys/sweep";
import { Sweep } from "../../../src/commands/create/sweep";
import { ensureGlobalStubApp, seedStepDatas, shapeStepResult, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Sweep", () => {
    test("should have command metadata", () => {
        const data = (Sweep as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.sweep");
        expect(data.icon).toBe("icon-sweep");
    });

    test("round should default to false", () => {
        const cmd = new Sweep();
        expect(cmd.round).toBe(false);
    });

    test("round setter should update property", () => {
        const cmd = new Sweep();
        cmd.round = true;
        expect(cmd.round).toBe(true);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Sweep();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("geometryNode", () => {
        function buildSweep(round: boolean) {
            const cmd = new Sweep();
            if (round) cmd.round = true;
            wireCommand(cmd);
            seedStepDatas(cmd, [
                // path: a wire.
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero }]),
                // profiles: two wires (multiple selection).
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero },
                    { shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero },
                ]),
            ]);
            return cmd;
        }

        test("should build a SweepedNode carrying the path and profiles with round=false", () => {
            const cmd = buildSweep(false);
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(SweepedNode);
            expect(node.round).toBe(false);
            expect(Array.isArray(node.profile)).toBe(true);
            expect(node.profile).toHaveLength(2);
            expect(node.path).toBeDefined();
        });

        test("should propagate round=true to the SweepedNode", () => {
            const cmd = buildSweep(true);
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(SweepedNode);
            expect(node.round).toBe(true);
        });

        test("should accept edge sections and convert them through ensureWire", () => {
            const cmd = new Sweep();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.edge }, point: XYZ.zero }]),
                shapeStepResult([{ shape: { shapeType: ShapeTypes.edge }, point: XYZ.zero }]),
            ]);
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(SweepedNode);
            expect(node.profile).toHaveLength(1);
        });
    });

    describe("getSteps callbacks", () => {
        test("the second step should carry beforeSelection/afterSelection that update highlight state", () => {
            const cmd = new Sweep();
            const { doc } = wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero }]),
            ]);

            const steps = (cmd as any).getSteps();
            const opts = steps[1].options;
            // invoking should not throw and should touch the highlighter.
            expect(() => opts.beforeSelection()).not.toThrow();
            expect(() => opts.afterSelection()).not.toThrow();
            expect((doc.visual.highlighter.addState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            expect((doc.visual.highlighter.removeState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
