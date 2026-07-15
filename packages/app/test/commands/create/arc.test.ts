// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Arc } from "../../../src/commands/create/arc";

describe("Arc", () => {
    test("should have command metadata", () => {
        const data = (Arc as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.arc");
        expect(data.icon).toBe("icon-arc");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Arc();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
