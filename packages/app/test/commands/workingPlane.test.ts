// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, PubSub } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import {
    AlignToPlane,
    FromSection,
    SetWorkplane,
    WorkingPlaneViewModel,
} from "../../src/commands/workingPlane";
import { createMockApplication, createMockDocument } from "../_helpers";

describe("WorkingPlaneViewModel", () => {
    test("should have default planes with XOY selected", () => {
        const vm = new WorkingPlaneViewModel();
        expect(vm.planes).toBeDefined();
        expect(vm.planes.selectedIndexes).toContain(0);
    });
});

describe("SetWorkplane", () => {
    test("should have command metadata", () => {
        const data = (SetWorkplane as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("workingPlane.set");
        expect(data.icon).toBe("icon-setWorkingPlane");
    });

    test("should do nothing when activeView is undefined", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new SetWorkplane();
        await cmd.execute(app);
    });

    test("should show dialog when activeView exists", async () => {
        let dialogShown = false;

        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ..._args: any[]) => {
            if (channel === "showDialog") {
                dialogShown = true;
            }
        }) as any;

        const app = createMockApplication();
        app.activeView = {
            document: createMockDocument(),
            workplane: Plane.XY,
        } as any;

        const cmd = new SetWorkplane();
        await cmd.execute(app);

        expect(dialogShown).toBe(true);

        PubSub.default.pub = originalPub;
    });
});

describe("AlignToPlane", () => {
    test("should have command metadata", () => {
        const data = (AlignToPlane as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("workingPlane.alignToPlane");
        expect(data.icon).toBe("icon-alignWorkingPlane");
    });

    test("should do nothing when activeView is undefined", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new AlignToPlane();
        await cmd.execute(app);
    });
});

describe("FromSection", () => {
    test("should have command metadata", () => {
        const data = (FromSection as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("workingPlane.fromSection");
        expect(data.icon).toBe("icon-fromSection");
    });

    test("getSteps should return two steps", () => {
        const cmd = new FromSection();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
