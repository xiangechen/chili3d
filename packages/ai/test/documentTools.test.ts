// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildDocumentTools } from "../src/tools/documentTools";

function newDocumentTool() {
    const tool = buildDocumentTools().find((candidate) => candidate.name === "new_document");
    if (!tool) throw new Error("new_document is not registered");
    return tool;
}

function stubApp(activeView: unknown, newDocument: unknown): void {
    const app = createMockApplication();
    (app as unknown as { activeView: unknown }).activeView = activeView;
    (app as unknown as { newDocument: unknown }).newDocument = newDocument;
    rs.stubGlobal("app", app);
}

describe("new_document", () => {
    afterEach(() => {
        rs.unstubAllGlobals();
    });

    test("creates an Untitled document when none is open", async () => {
        const create = rs.fn(async (name: string) => ({ id: "doc-1", name }));
        stubApp(undefined, create);

        const result = JSON.parse((await newDocumentTool().handler({})) as string);

        expect(result).toEqual({ documentId: "doc-1", name: "Untitled" });
        expect(create).toHaveBeenCalledWith("Untitled");
    });

    test("uses the name it was given", async () => {
        const create = rs.fn(async (name: string) => ({ id: "doc-2", name }));
        stubApp(undefined, create);

        const result = JSON.parse((await newDocumentTool().handler({ name: "Part 1" })) as string);

        expect(result.name).toBe("Part 1");
        expect(create).toHaveBeenCalledWith("Part 1");
    });

    test("refuses to replace a document that is already open", async () => {
        const document = createMockDocument({ name: "part" });
        const create = rs.fn(async (name: string) => ({ id: "doc-3", name }));
        stubApp({ document }, create);

        const result = JSON.parse((await newDocumentTool().handler({})) as string);

        expect(result.error).toContain("already open");
        expect(result.documentId).toBe(document.id);
        expect(create).not.toHaveBeenCalled();
    });
});
