// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n } from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildTools } from "../src/tools";
import { buildParametricTools } from "../src/tools/parametricTools";

const runParametric = () => buildParametricTools().find((tool) => tool.name === "run_parametric")!;

interface OpsSchema {
    properties: { op: { enum: string[] } };
    required: string[];
}

/** The tool's op schema, reached through the JSON the providers send. */
const opsSchema = () => (runParametric().parameters as any).properties.ops.items as OpsSchema;

describe("parametricTools", () => {
    test("run_parametric is registered, and appended after the shipped tools", () => {
        const names = buildTools().map((tool) => tool.name);
        expect(names).toContain("run_parametric");
        // The API matches the cached prompt prefix in order tools -> system -> messages, so a
        // tool inserted anywhere but the end would invalidate the cached list of every
        // conversation that started before it existed. load_skill is the last shipped tool.
        expect(names.indexOf("run_parametric")).toBeGreaterThan(names.indexOf("load_skill"));
    });

    test("the op schema enumerates every supported op", () => {
        expect(opsSchema().properties.op.enum).toEqual([
            "sketch",
            "extrude",
            "revolve",
            "fillet",
            "chamfer",
            "boolean",
            "editFeature",
            "features",
        ]);
        expect(opsSchema().required).toEqual(["op"]);
        expect((runParametric().parameters as any).required).toEqual(["ops"]);
    });

    test("returns the no-document error rather than throwing", async () => {
        const result = await runParametric().handler({ ops: [{ op: "features", body: "b1" }] });
        expect(JSON.parse(result as string).error).toBe(I18n.translate("ai.error.noDocument"));
    });

    test("rejects a missing or empty ops array before loading the parametric module", async () => {
        const app = createMockApplication();
        (app as any).activeView = { document: createMockDocument() };
        rs.stubGlobal("app", app);

        try {
            await expect(runParametric().handler({})).rejects.toThrow(/non-empty "ops" array/);
            await expect(runParametric().handler({ ops: [] })).rejects.toThrow(/non-empty "ops" array/);
        } finally {
            rs.unstubAllGlobals();
        }
    });
});
