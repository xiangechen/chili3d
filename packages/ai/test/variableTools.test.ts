// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildVariableTools } from "../src/tools/variableTools";

const tool = () => buildVariableTools().find((candidate) => candidate.name === "document_variables")!;

/** Runs the handler against a real VariableTable — createMockDocument's stub has no behavior. */
async function withDocument<T>(run: (doc: TestDocument) => Promise<T>): Promise<T> {
    const doc = new TestDocument({ application: createMockApplication() });
    const app = createMockApplication();
    (app as any).activeView = { document: doc };
    rs.stubGlobal("app", app);
    try {
        return await run(doc);
    } finally {
        rs.unstubAllGlobals();
    }
}

const call = async (args: Record<string, unknown>) => JSON.parse((await tool().handler(args)) as string);

const entries = (result: { variables: unknown[] }) => result.variables;

describe("variableTools", () => {
    test("lists an empty table", async () => {
        await withDocument(async () => {
            expect(entries(await call({ action: "list" }))).toEqual([]);
        });
    });

    test("set writes a variable and reports what it resolves to", async () => {
        await withDocument(async () => {
            const result = await call({
                action: "set",
                variables: [{ name: "width", type: "length", expression: "40" }],
            });

            expect(entries(result)).toEqual([{ name: "width", type: "length", expression: "40", value: 40 }]);
        });
    });

    test("set upserts by name — an existing variable keeps its place in the table", async () => {
        await withDocument(async (doc) => {
            await call({
                action: "set",
                variables: [
                    { name: "width", type: "length", expression: "40" },
                    { name: "height", type: "length", expression: "width * 2" },
                ],
            });

            const result = await call({
                action: "set",
                variables: [{ name: "width", type: "length", expression: "10" }],
            });

            // Still two rows, in the original order, and the downstream one re-resolved.
            expect(entries(result)).toEqual([
                { name: "width", type: "length", expression: "10", value: 10 },
                { name: "height", type: "length", expression: "width * 2", value: 20 },
            ]);
            expect(doc.variables.items.map((item) => item.name)).toEqual(["width", "height"]);
        });
    });

    test("a variable may reference the ones declared above it", async () => {
        await withDocument(async () => {
            const result = await call({
                action: "set",
                variables: [
                    { name: "width", type: "length", expression: "40" },
                    { name: "half", type: "length", expression: "width / 2" },
                ],
            });

            expect(entries(result).at(1)).toEqual({
                name: "half",
                type: "length",
                expression: "width / 2",
                value: 20,
            });
        });
    });

    test("an expression that cannot resolve is reported on its own row, not thrown", async () => {
        await withDocument(async () => {
            const result = await call({
                action: "set",
                variables: [{ name: "half", type: "length", expression: "width / 2" }],
            });

            // The table keeps a bad row without taking the rest down, so the row's error is
            // the answer — the model has to be told, but nothing rolls back.
            const [row] = entries(result) as { name: string; error?: string }[];
            expect(row.name).toBe("half");
            expect(row.error).toBeDefined();
        });
    });

    test("remove drops the named variables and keeps the rest", async () => {
        await withDocument(async () => {
            await call({
                action: "set",
                variables: [
                    { name: "width", type: "length", expression: "40" },
                    { name: "height", type: "length", expression: "30" },
                ],
            });

            const result = await call({ action: "remove", names: ["width"] });

            expect(entries(result)).toEqual([
                { name: "height", type: "length", expression: "30", value: 30 },
            ]);
        });
    });

    test("one call is one undo step", async () => {
        await withDocument(async (doc) => {
            await call({
                action: "set",
                variables: [{ name: "width", type: "length", expression: "40" }],
            });
            expect(doc.variables.items).toHaveLength(1);

            doc.history.undo();
            expect(doc.variables.items).toEqual([]);
        });
    });

    test("rejects a variable type outside the union", async () => {
        await withDocument(async () => {
            await expect(
                tool().handler({
                    action: "set",
                    variables: [{ name: "width", type: "weight", expression: "40" }],
                }),
            ).rejects.toThrow(/length, angle or unitless/);
        });
    });

    test("rejects an unknown action", async () => {
        await withDocument(async () => {
            await expect(tool().handler({ action: "rename" })).rejects.toThrow(/unknown action/);
        });
    });

    test("returns the no-document error rather than throwing", async () => {
        const result = JSON.parse((await tool().handler({ action: "list" })) as string);
        expect(result.error).toBeDefined();
    });
});
