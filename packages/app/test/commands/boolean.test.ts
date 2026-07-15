// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ShapeNode } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { BooleanCommon, BooleanCut, BooleanFuse } from "../../src/commands/boolean";

describe("BooleanCommon", () => {
    test("should have command metadata", () => {
        const data = (BooleanCommon as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("boolean.common");
        expect(data.icon).toBe("icon-booleanCommon");
    });

    test("getBooleanOperateType should return 'common'", () => {
        const cmd = new BooleanCommon();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("common");
    });

    test("getSteps should return two SelectShapeSteps", () => {
        const cmd = new BooleanCommon();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    test("keepTools should default to false", () => {
        const cmd = new BooleanCommon();
        expect(cmd.keepTools).toBe(false);
    });

    test("keepTools setter should update property", () => {
        const cmd = new BooleanCommon();
        cmd.keepTools = true;
        expect(cmd.keepTools).toBe(true);

        cmd.keepTools = false;
        expect(cmd.keepTools).toBe(false);
    });
});

describe("BooleanCut", () => {
    test("should have command metadata", () => {
        const data = (BooleanCut as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("boolean.cut");
        expect(data.icon).toBe("icon-booleanCut");
    });

    test("getBooleanOperateType should return 'cut'", () => {
        const cmd = new BooleanCut();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("cut");
    });

    test("should extend BooleanOperate", () => {
        const cmd = new BooleanCut();
        expect(cmd.keepTools).toBe(false);
    });
});

describe("BooleanFuse", () => {
    test("should have command metadata", () => {
        const data = (BooleanFuse as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("boolean.join");
        expect(data.icon).toBe("icon-booleanFuse");
    });

    test("getBooleanOperateType should return 'fuse'", () => {
        const cmd = new BooleanFuse();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("fuse");
    });

    test("should extend BooleanOperate", () => {
        const cmd = new BooleanFuse();
        expect(cmd.keepTools).toBe(false);
    });
});
