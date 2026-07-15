// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { Undo } from "../../src/commands/undo";
import { createMockApplication, createMockDocument } from "../_helpers";

describe("Undo", () => {
    test("should have command metadata", () => {
        const data = (Undo as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("edit.undo");
        expect(data.icon).toBe("icon-undo");
    });

    test("should call history.undo and visual.update when document exists", async () => {
        const doc = createMockDocument();
        let undoCallCount = 0;
        let visualUpdateCallCount = 0;

        doc.history.undo = async () => {
            undoCallCount++;
        };
        doc.visual.update = () => {
            visualUpdateCallCount++;
        };

        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const cmd = new Undo();
        await cmd.execute(app);

        expect(undoCallCount).toBe(1);
        expect(visualUpdateCallCount).toBe(1);
    });

    test("should do nothing when activeView is undefined", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new Undo();
        // Should not throw
        await cmd.execute(app);
    });

    test("should do nothing when activeView document is undefined", async () => {
        const app = createMockApplication();
        app.activeView = { document: undefined } as any;

        const cmd = new Undo();
        // Should not throw
        await cmd.execute(app);
    });
});
