// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type Act, I18n } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { ActAlignCameraCommand } from "../../src/commands/createActCommand";
import { createMockApplication } from "../_helpers";

describe("ActAlignCameraCommand", () => {
    test("should have command metadata via @command decorator", () => {
        const cmd = new ActAlignCameraCommand();
        const data = (Object.getPrototypeOf(cmd).constructor as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("act.alignCamera");
        expect(data.icon).toBe("icon-act");
    });

    test("should do nothing when activeView is undefined", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new ActAlignCameraCommand();
        await cmd.execute(app);
    });

    test("should push an Act to the document acts collection", async () => {
        const pushedActs: Act[] = [];
        const app = createMockApplication();
        app.activeView = {
            document: {
                acts: {
                    push: (act: Act) => {
                        pushedActs.push(act);
                        return 0;
                    },
                },
            },
            cameraController: {
                cameraPosition: { x: 1, y: 2, z: 3 },
                cameraTarget: { x: 0, y: 0, z: 0 },
                cameraUp: { x: 0, y: 0, z: 1 },
            },
        } as any;

        const cmd = new ActAlignCameraCommand();
        await cmd.execute(app);

        expect(pushedActs.length).toBe(1);
        expect(pushedActs[0].cameraPosition).toEqual({ x: 1, y: 2, z: 3 });
        expect(pushedActs[0].cameraTarget).toEqual({ x: 0, y: 0, z: 0 });
        expect(pushedActs[0].cameraUp).toEqual({ x: 0, y: 0, z: 1 });
    });

    test("act name should include translated group name and incrementing index", async () => {
        const pushedActs: Act[] = [];
        const app = createMockApplication();
        app.activeView = {
            document: {
                acts: {
                    push: (act: Act) => {
                        pushedActs.push(act);
                        return 0;
                    },
                },
            },
            cameraController: {
                cameraPosition: { x: 0, y: 0, z: 5 },
                cameraTarget: { x: 0, y: 0, z: 0 },
                cameraUp: { x: 0, y: 1, z: 0 },
            },
        } as any;

        const cmd1 = new ActAlignCameraCommand();
        await cmd1.execute(app);

        const cmd2 = new ActAlignCameraCommand();
        await cmd2.execute(app);

        expect(pushedActs.length).toBe(2);
        // Names should be different due to incrementing index
        expect(pushedActs[0].name).not.toBe(pushedActs[1].name);
    });
});
