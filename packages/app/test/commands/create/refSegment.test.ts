// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { RefSegment } from "../../../src/commands/create/refSegment";

describe("RefSegment", () => {
    test("should have command metadata", () => {
        const data = (RefSegment as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.refSegment");
        expect(data.icon).toBe("icon-line");
    });

    test("getSteps should return two steps", () => {
        const cmd = new RefSegment();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
