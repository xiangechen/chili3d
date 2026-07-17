// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { PointNode } from "../../../src/bodys/point";
import { Point } from "../../../src/commands/create/point";
import { seedStepDatas, stubGlobalApp, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = stubGlobalApp();
});
afterAll(() => restoreApp());

describe("Point", () => {
    test("should have command metadata", () => {
        const data = (Point as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.point");
        expect(data.icon).toBe("icon-point");
    });

    test("getSteps should return one step", () => {
        const cmd = new Point();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    test("geometryNode should create a PointNode at the step data position", () => {
        const cmd = new Point();
        wireCommand(cmd);
        seedStepDatas(cmd, [{ point: new XYZ({ x: 10, y: 20, z: 30 }) }] as any);

        const node = (cmd as any).geometryNode();
        expect(node).toBeInstanceOf(PointNode);
        expect(node.position.x).toBe(10);
        expect(node.position.y).toBe(20);
        expect(node.position.z).toBe(30);
    });
});
