// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, Result, ShapeTypes, XYZ } from "@chili3d/core";
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
        expect(data).not.toBeNull();
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
                // profiles: two wires (multiple selection).
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero },
                    { shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero },
                ]),
                // path: a wire.
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero }]),
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
            // Profiles come first, so the single edge here is the profile and the second
            // one the path — the same shape as before the step order changed.
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(SweepedNode);
            expect(node.profile).toHaveLength(1);
        });
    });

    test("each path edge refreshes the preview while the pick stays open", async () => {
        const stubApp = (globalThis as any).app;
        const originalFactory = stubApp.shapeProvider.factory;
        const solid = { mesh: { faces: {}, edges: {} }, dispose: () => {} };
        const wire = { shapeType: ShapeTypes.wire, dispose: () => {} };
        stubApp.shapeProvider.factory = {
            wire: () => Result.ok(wire),
            sweep: () => Result.ok(solid),
        };
        try {
            const cmd = new Sweep();
            const { doc } = wireCommand(cmd);
            const profile = shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero }]);
            const edge = shapeStepResult([{ shape: { shapeType: ShapeTypes.edge }, point: XYZ.zero }]);
            const steps = [profile, edge, edge];
            (cmd as any).runStep = async () => {
                const next = steps.shift();
                if (next === undefined) {
                    (cmd as any).controller = { result: { status: "success" }, dispose: () => {} };
                }
                return next;
            };

            const ok = await (cmd as any).executeSteps();

            expect(ok).toBe(true);
            expect(doc.visual.context.displayMesh).toHaveBeenCalledTimes(2);
        } finally {
            stubApp.shapeProvider.factory = originalFactory;
        }
    });

    describe("buildWire", () => {
        test("a single wire is accepted as the whole path", () => {
            const cmd = new Sweep();
            wireCommand(cmd);
            const wire = { shapeType: ShapeTypes.wire, transformedMul: () => wire };
            const result = (cmd as any).buildWire([{ shape: wire, transform: Matrix4.identity() }]);
            expect(result.isOk).toBe(true);
        });

        test("a wire cannot be mixed with edge picks", () => {
            const cmd = new Sweep();
            wireCommand(cmd);
            const wire = { shapeType: ShapeTypes.wire, transformedMul: () => wire };
            const edge = { shapeType: ShapeTypes.edge, transformedMul: () => edge };
            const result = (cmd as any).buildWire([
                { shape: wire, transform: Matrix4.identity() },
                { shape: edge, transform: Matrix4.identity() },
            ]);
            expect(result.isOk).toBe(false);
        });

        test("the edge copies fed to the wire are released", () => {
            const cmd = new Sweep();
            wireCommand(cmd);
            const disposed: number[] = [];
            const copies = [0, 1].map((i) => ({ dispose: () => disposed.push(i) }));
            const edges = [0, 1].map((i) => ({
                shape: { shapeType: ShapeTypes.edge, transformedMul: () => copies[i] },
                transform: Matrix4.identity(),
            }));

            const result = (cmd as any).buildWire(edges);

            expect(result.isOk).toBe(true);
            expect(disposed).toEqual([0, 1]);
        });
    });

    describe("getSteps", () => {
        test("profiles come first, then the path one edge at a time", () => {
            const cmd = new Sweep();
            wireCommand(cmd);

            const steps = (cmd as any).getSteps();
            expect(steps[0].snapeType).toBe(ShapeTypes.edge | ShapeTypes.wire);
            expect(steps[0].options.multiple).toBe(true);
            expect(steps[0].options.showConfirmControl).toBe(true);
            expect(steps[1].snapeType).toBe(ShapeTypes.edge | ShapeTypes.wire);
            expect(steps[1].options.multiple).toBe(false);
            expect(steps[1].options.showConfirmControl).toBe(true);
        });

        test("a later path edge may come from another node", () => {
            // The path is built in world coordinates into one wire; unlike the parametric
            // sweep's stored refs, nothing ties it to a single node.
            const cmd = new Sweep();
            wireCommand(cmd);
            const opts = (cmd as any).getSteps()[1].options;
            expect(opts.nodeFilter).toBeUndefined();
        });
    });
});
