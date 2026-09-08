// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildReadTools } from "../src/tools/readTools";

describe("readTools", () => {
    test("get_document_state reports no document when absent", async () => {
        const app = createMockApplication();
        app.activeView = undefined;
        rs.stubGlobal("app", app);
        try {
            const tool = buildReadTools().find((t) => t.name === "get_document_state")!;
            const result = JSON.parse((await tool.handler({})) as string);
            expect(result).toEqual({ hasActiveDocument: false });
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("get_document_state summarizes nodes", async () => {
        const doc = createMockDocument({ name: "part" });
        const findNodes = rs.fn(() => [{ id: "a", name: "box", constructor: { name: "BoxNode" } }]);
        (doc.modelManager as any).findNodes = findNodes;

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);
        try {
            const tool = buildReadTools().find((t) => t.name === "get_document_state")!;
            const result = JSON.parse((await tool.handler({})) as string);
            expect(result.hasActiveDocument).toBe(true);
            expect(result.name).toBe("part");
            expect(result.nodes).toEqual([{ id: "a", type: "BoxNode", name: "box" }]);
        } finally {
            rs.unstubAllGlobals();
        }
    });
});
