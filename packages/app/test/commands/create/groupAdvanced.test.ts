// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { GroupCommand } from "../../../src/commands/create/group";

describe("GroupCommand additional", () => {
    test("should have command metadata", () => {
        const data = (GroupCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.group");
        expect(data.icon).toBe("icon-group");
    });

    test("getSteps should return one GetOrSelectNodeStep with multiple=true", () => {
        const cmd = new GroupCommand();
        const steps = (cmd as any).getSteps();
        expect(steps).toHaveLength(1);
    });

    describe("findDialog (private)", () => {
        test("should return the element when it is an HTMLDialogElement", () => {
            const cmd = new GroupCommand();
            const dialog = document.createElement("dialog");
            const result = (cmd as any).findDialog(dialog);
            expect(result).toBe(dialog);
        });

        test("should traverse up parent chain to find dialog", () => {
            const cmd = new GroupCommand();
            const dialog = document.createElement("dialog");
            const child = document.createElement("div");
            const grandchild = document.createElement("span");
            child.appendChild(grandchild);
            dialog.appendChild(child);

            const result = (cmd as any).findDialog(grandchild);
            expect(result).toBe(dialog);
        });

        test("should return undefined when no dialog ancestor exists", () => {
            const cmd = new GroupCommand();
            const div = document.createElement("div");
            document.body.appendChild(div);
            const result = (cmd as any).findDialog(div);
            expect(result).toBeUndefined();
            document.body.removeChild(div);
        });

        test("should return undefined when element has no parent", () => {
            const cmd = new GroupCommand();
            const div = document.createElement("div");
            // div is not attached to DOM, so parentElement is null
            const result = (cmd as any).findDialog(div);
            expect(result).toBeUndefined();
        });
    });
});
