// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, type IDocument, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { PolygonNode } from "../../../src/bodys";
import { Polygon } from "../../../src/commands/create/polygon";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Polygon", () => {
    test("should have command metadata", () => {
        const data = (Polygon as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("create.polygon");
        expect(data.icon).toBe("icon-toPoly");
    });

    test("should extend CreateFaceableCommand", () => {
        const cmd = new Polygon();
        expect(cmd.isFace).toBe(true);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Polygon();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function polygonWithPoints(points: XYZ[]): Polygon {
        const cmd = new Polygon();
        wireCommand(cmd);
        seedStepDatas(
            cmd,
            points.map((p) => pointStepResult({ point: p })),
        );
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build a PolygonNode from step data points", () => {
            const cmd = polygonWithPoints([
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            ]);
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(PolygonNode);
        });

        test("should respect the isFace flag", () => {
            const cmd = polygonWithPoints([
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            ]);
            cmd.isFace = false;
            const node = (cmd as any).geometryNode();
            expect(node.isFace).toBe(false);
        });
    });

    describe("getNextData", () => {
        test("should expose refPoint, dimension, validator, preview, and featurePoints", () => {
            const cmd = polygonWithPoints([new XYZ({ x: 0, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            expect(typeof data.refPoint).toBe("function");
            expect(typeof data.validator).toBe("function");
            expect(typeof data.preview).toBe("function");
            expect(Array.isArray(data.featurePoints)).toBe(true);
        });

        test("refPoint should return the last step's point", () => {
            const cmd = polygonWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 1, z: 0 })]);
            const data = (cmd as any).getNextData();
            expect(data.refPoint().isEqualTo(new XYZ({ x: 3, y: 1, z: 0 }))).toBe(true);
        });

        test("featurePoints should include close point when more than 2 steps", () => {
            const cmd = polygonWithPoints([
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            ]);
            const data = (cmd as any).getNextData();
            expect(data.featurePoints).toHaveLength(1);
            expect(data.featurePoints[0].when()).toBe(true);
        });
    });

    describe("validator", () => {
        test("should reject a point coincident with any existing step data", () => {
            const cmd = polygonWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
            expect(data.validator(new XYZ({ x: 5, y: 0, z: 0 }))).toBe(false);
        });

        test("should accept a distinct point", () => {
            const cmd = polygonWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            expect(data.validator(new XYZ({ x: 3, y: 3, z: 0 }))).toBe(true);
        });
    });

    describe("preview", () => {
        test("should render mesh points for all existing steps", () => {
            const cmd = polygonWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            const preview = data.preview(undefined);
            expect(preview.length).toBeGreaterThan(0);
        });

        test("should include the new point when given", () => {
            const cmd = polygonWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            const preview = data.preview(new XYZ({ x: 3, y: 3, z: 0 }));
            expect(preview.length).toBeGreaterThan(0);
        });
    });

    /**
     * Drives the real step and pick lifecycle: one `pickAsync` call per click. A click
     * succeeds with the point under the cursor; the confirm button succeeds with nothing
     * under it, which is the state the pointer is in once it leaves the viewport for the
     * command panel (`SnapEventHandler.pointerOut`).
     */
    function drivePicks(doc: IDocument, points: (XYZ | undefined)[]) {
        let call = 0;
        (doc.picker as any).pickAsync = async (handler: any, _tip: unknown, controller: AsyncController) => {
            const point = points[call++];
            handler["_snaped"] = point === undefined ? undefined : { point, shapes: [], nodes: [] };
            controller.success();
        };
    }

    describe("finishing early", () => {
        test("the confirm button commits the points placed so far", async () => {
            const cmd = new Polygon() as any;
            const { doc } = wireCommand(cmd);
            drivePicks(doc, [
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 5, z: 0 }),
                undefined,
            ]);

            expect(await cmd.executeSteps()).toBe(true);
            expect(cmd.stepDatas).toHaveLength(3);
        });

        test("a cancel with no confirm aborts and commits nothing", async () => {
            const cmd = new Polygon() as any;
            const { doc } = wireCommand(cmd);
            let call = 0;
            (doc.picker as any).pickAsync = async (
                handler: any,
                _tip: unknown,
                controller: AsyncController,
            ) => {
                if (call++ === 0) {
                    handler["_snaped"] = { point: XYZ.zero, shapes: [], nodes: [] };
                    controller.success();
                    return;
                }
                controller.cancel();
            };

            expect(await cmd.executeSteps()).toBe(false);
        });

        test("the second step asks for the viewport confirm bar", async () => {
            const cmd = new Polygon() as any;
            const { doc } = wireCommand(cmd);
            // The step's own data reads the point placed before it.
            seedStepDatas(cmd, [pointStepResult({ point: XYZ.zero })]);
            const controls: unknown[] = [];
            (doc.picker as any).pickAsync = async (
                _handler: any,
                _tip: unknown,
                controller: AsyncController,
                control: unknown,
            ) => {
                controls.push(control);
                controller.success();
            };

            const steps = cmd.getSteps();
            await steps[1].execute(doc, new AsyncController());

            expect(controls).toEqual(["confirm"]);
        });
    });
});
