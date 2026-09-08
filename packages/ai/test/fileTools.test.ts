// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualNode } from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildFileTools } from "../src/tools/fileTools";

function visualNode(id: string, name: string) {
    const node = Object.create(VisualNode.prototype);
    Object.defineProperty(node, "id", { value: id });
    Object.defineProperty(node, "name", { value: name });
    return node;
}

describe("fileTools", () => {
    test("export_nodes exports the given nodes and downloads the file", async () => {
        const node = visualNode("n1", "box");
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        (app as any).dataExchange = {
            exportFormats: () => [".step", ".stl"],
            export: rs.fn(async () => ["data"]),
        };
        rs.stubGlobal("app", app);
        const createObjectURL = URL.createObjectURL;
        const revokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = rs.fn(() => "blob:mock") as any;
        URL.revokeObjectURL = rs.fn(() => {}) as any;

        try {
            const tool = buildFileTools().find((t) => t.name === "export_nodes")!;
            const result = JSON.parse((await tool.handler({ format: ".step", ids: ["n1"] })) as string);
            expect(result.ok).toBe(true);
            expect(result.filename).toBe("box.step");
            expect(app.dataExchange.export).toHaveBeenCalledWith(".step", [node]);
        } finally {
            URL.createObjectURL = createObjectURL;
            URL.revokeObjectURL = revokeObjectURL;
            rs.unstubAllGlobals();
        }
    });

    test("export_nodes appends the missing extension to a custom filename", async () => {
        const node = visualNode("n1", "box");
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        (app as any).dataExchange = {
            exportFormats: () => [".step"],
            export: rs.fn(async () => ["data"]),
        };
        rs.stubGlobal("app", app);
        const createObjectURL = URL.createObjectURL;
        const revokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = rs.fn(() => "blob:mock") as any;
        URL.revokeObjectURL = rs.fn(() => {}) as any;

        try {
            const tool = buildFileTools().find((t) => t.name === "export_nodes")!;
            const result = JSON.parse(
                (await tool.handler({ format: ".step", ids: ["n1"], filename: "part" })) as string,
            );
            expect(result.filename).toBe("part.step");
        } finally {
            URL.createObjectURL = createObjectURL;
            URL.revokeObjectURL = revokeObjectURL;
            rs.unstubAllGlobals();
        }
    });

    test("export_nodes rejects an unknown format and missing nodes", async () => {
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => []);

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        (app as any).dataExchange = {
            exportFormats: () => [".step"],
            export: rs.fn(async () => ["data"]),
        };
        rs.stubGlobal("app", app);

        try {
            const tool = buildFileTools().find((t) => t.name === "export_nodes")!;
            const badFormat = JSON.parse((await tool.handler({ format: ".obj", ids: ["n1"] })) as string);
            expect(badFormat.error).toContain("unknown format");
            const missing = JSON.parse((await tool.handler({ format: ".step", ids: ["n1"] })) as string);
            expect(missing.error).toContain("nodes not found");
            expect(app.dataExchange.export).not.toHaveBeenCalled();
        } finally {
            rs.unstubAllGlobals();
        }
    });
});
