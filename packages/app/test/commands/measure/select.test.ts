// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { SelectMeasure } from "../../../src/commands/measure/select";

describe("SelectMeasure", () => {
    test("should have command metadata", () => {
        const data = (SelectMeasure as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("measure.select");
        expect(data.icon).toBe("icon-measureSelect");
    });

    test("category should default to 'common.length'", () => {
        const cmd = new SelectMeasure();
        expect(cmd.category).toBe("common.length");
    });

    test("category setter should update property", () => {
        const cmd = new SelectMeasure();
        cmd.category = "common.area";
        expect(cmd.category).toBe("common.area");

        cmd.category = "common.volume";
        expect(cmd.category).toBe("common.volume");
    });

    test("category setter should accept all three measure types", () => {
        const cmd = new SelectMeasure();
        const types = ["common.length", "common.area", "common.volume"] as const;
        for (const type of types) {
            cmd.category = type;
            expect(cmd.category).toBe(type);
        }
    });

    test("wireCenter should compute center of points array", () => {
        const cmd = new SelectMeasure();
        // 4 points: (0,0,0), (2,0,0), (2,2,0), (0,2,0) — center at (1,1,0)
        const positions = new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0]);
        const center = (cmd as any).wireCenter(positions);
        expect(center.x).toBeCloseTo(1);
        expect(center.y).toBeCloseTo(1);
        expect(center.z).toBeCloseTo(0);
    });

    test("wireCenter should handle single point", () => {
        const cmd = new SelectMeasure();
        const positions = new Float32Array([5, 10, 15]);
        const center = (cmd as any).wireCenter(positions);
        expect(center.x).toBeCloseTo(5);
        expect(center.y).toBeCloseTo(10);
        expect(center.z).toBeCloseTo(15);
    });

    test("wireCenter should handle two points", () => {
        const cmd = new SelectMeasure();
        const positions = new Float32Array([0, 0, 0, 10, 0, 0]);
        const center = (cmd as any).wireCenter(positions);
        expect(center.x).toBeCloseTo(5);
        expect(center.y).toBeCloseTo(0);
        expect(center.z).toBeCloseTo(0);
    });
});
