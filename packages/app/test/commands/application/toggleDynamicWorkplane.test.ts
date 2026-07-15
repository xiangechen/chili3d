// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { ToggleDynamicWorkplaneCommand } from "../../../src/commands/application/toggleDynamicWorkplane";
import { createMockApplication } from "../../_helpers";

describe("ToggleDynamicWorkplaneCommand", () => {
    test("should have command metadata", () => {
        const data = (ToggleDynamicWorkplaneCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("workingPlane.toggleDynamic");
        expect(data.icon).toBe("icon-dynamicPlane");
    });

    test("should toggle dynamicWorkplane config", async () => {
        const app = createMockApplication();
        const cmd = new ToggleDynamicWorkplaneCommand();

        const before = Config.instance.dynamicWorkplane;
        await cmd.execute(app);
        expect(Config.instance.dynamicWorkplane).toBe(!before);

        // Toggle back
        await cmd.execute(app);
        expect(Config.instance.dynamicWorkplane).toBe(before);
    });
});
