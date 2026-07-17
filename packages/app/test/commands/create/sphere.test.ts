// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { SphereNode } from "../../../src/bodys/sphere";
import { Sphere } from "../../../src/commands/create/sphere";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Sphere", () => {
    test("should have command metadata", () => {
        const data = (Sphere as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.sphere");
        expect(data.icon).toBe("icon-sphere");
    });

    test("getSteps should return center + radius steps", () => {
        const cmd = new Sphere();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function sphereFromTwoPoints(center: XYZ, radiusPick: XYZ): Sphere {
        const cmd = new Sphere();
        wireCommand(cmd);
        seedStepDatas(cmd, [pointStepResult({ point: center }), pointStepResult({ point: radiusPick })]);
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build a SphereNode whose radius is the distance between the two picks", () => {
            const cmd = sphereFromTwoPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 4, z: 0 }));
            const node = (cmd as any).geometryNode();

            expect(node).toBeInstanceOf(SphereNode);
            expect(node.radius).toBeCloseTo(5, 6);
            expect(node.center.isEqualTo(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(true);
        });

        test("should compute radius for an axis-aligned pick", () => {
            const cmd = sphereFromTwoPoints(new XYZ({ x: 1, y: 1, z: 1 }), new XYZ({ x: 1, y: 1, z: 6 }));
            const node = (cmd as any).geometryNode();
            expect(node.radius).toBeCloseTo(5, 6);
        });
    });

    describe("getRadiusData", () => {
        test("should expose a preview and a validator that rejects zero distance", () => {
            const center = new XYZ({ x: 0, y: 0, z: 0 });
            const cmd = sphereFromTwoPoints(center, new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).getRadiusData();

            expect(typeof data.preview).toBe("function");
            expect(typeof data.validator).toBe("function");
            // coincident point rejected
            expect(data.validator(center)).toBe(false);
            // distant point accepted
            expect(data.validator(new XYZ({ x: 2, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("previewSphere", () => {
        test("should render only the center vertex when end is undefined", () => {
            const cmd = sphereFromTwoPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const preview = (cmd as any).previewSphere(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render center + two circle preview meshes when end is given", () => {
            const cmd = sphereFromTwoPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const preview = (cmd as any).previewSphere(new XYZ({ x: 3, y: 0, z: 0 }));
            // [meshPoint(center), meshCreatedShape(circle Z), meshCreatedShape(circle Y)]
            expect(preview).toHaveLength(3);
        });
    });
});
