// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { OccPerformanceTestCommand } from "../../../src/commands/application/performanceTest";

describe("OccPerformanceTestCommand", () => {
    test("should have command metadata", () => {
        const data = (OccPerformanceTestCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("test.performance");
        expect(data.icon).toBe("icon-performance");
    });
});
