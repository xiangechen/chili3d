// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Material, XY } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { afterEach, describe, expect, rs, test } from "@rstest/core";
import { buildMaterialTools } from "../src/tools/materialTools";

describe("material tools", () => {
    function getTool(name: string) {
        const tool = buildMaterialTools().find((t) => t.name === name);
        expect(tool).toBeDefined();
        return tool!;
    }

    /** The document's materials; the mock holds them in a plain array. */
    function materials(doc: ReturnType<typeof createMockDocument>): Material[] {
        return doc.modelManager.materials as unknown as Material[];
    }

    /** A document holding one material, with the active view the tools reach through. */
    function stubDocument() {
        const doc = createMockDocument();
        const material = new Material({ document: doc, name: "Steel", color: 0x112233 });
        materials(doc).push(material);
        (doc.visual as unknown as { update: () => void }).update = rs.fn(() => {});
        rs.stubGlobal("app", { activeView: { document: doc } });
        return { doc, material };
    }

    async function run(name: string, args: Record<string, unknown> = {}) {
        const result = await getTool(name).handler(args);
        return JSON.parse(typeof result === "string" ? result : result.content);
    }

    /** One property row of a `get_material` / `set_material_properties` answer. */
    interface Row {
        name: string;
        kind: string;
        value?: unknown;
        readOnly?: boolean;
        options?: string[];
    }

    function row(rows: Row[], name: string) {
        const found = rows.find((r) => r.name === name);
        expect(found).toBeDefined();
        return found!;
    }

    afterEach(() => {
        rs.unstubAllGlobals();
    });

    describe("list_materials", () => {
        test("lists the document's materials with the values that shape them", async () => {
            const { material } = stubDocument();
            material.roughness = 0.2;

            const result = await run("list_materials");

            expect(result.materials).toEqual([
                {
                    id: material.id,
                    name: "Steel",
                    color: 0x112233,
                    opacity: 1,
                    roughness: 0.2,
                    metalness: 0,
                },
            ]);
        });
    });

    describe("get_material", () => {
        test("reads the material's rows, the way the material editor shows them", async () => {
            const { material } = stubDocument();
            material.metalness = 1;
            material.normalScale = new XY({ x: 2, y: 3 });
            material.map.image = "data:image/png;base64,AAAA";

            const result = await run("get_material", { id: material.id });

            expect(result.material.id).toBe(material.id);
            expect(result.material.name).toBe("Steel");
            const rows: Row[] = result.material.properties;
            expect(rows.map((r) => r.name)).toContain("roughness");
            expect(row(rows, "roughness")).toMatchObject({ kind: "number", value: 0.5 });
            expect(row(rows, "metalness")).toMatchObject({ kind: "number", value: 1 });
            expect(row(rows, "color")).toMatchObject({ kind: "color", value: 0x112233 });
            expect(row(rows, "normalScale")).toMatchObject({ kind: "xy", value: { x: 2, y: 3 } });
            // a texture slot reads as the image on it
            expect(row(rows, "map")).toMatchObject({ kind: "texture", value: "data:image/png;base64,AAAA" });
        });

        test("reports an unknown id along with the materials that do exist", async () => {
            const { material } = stubDocument();

            const result = await run("get_material", { id: "nope" });

            expect(result.error).toContain("material not found: nope");
            expect(result.available).toEqual([{ id: material.id, name: "Steel" }]);
        });
    });

    describe("set_material_properties", () => {
        test("writes the properties it is given, in one step", async () => {
            const { doc, material } = stubDocument();

            const result = await run("set_material_properties", {
                id: material.id,
                properties: { roughness: 0.1, metalness: 0.9, emissive: "#00ff00" },
            });

            expect(material.roughness).toBe(0.1);
            expect(material.metalness).toBe(0.9);
            expect(material.emissive).toBe("#00ff00");
            // the viewport redraws, and the answer reports what changed
            expect((doc.visual as unknown as { update: () => void }).update).toHaveBeenCalledTimes(1);
            expect(result.updated.map((r: Row) => r.name)).toEqual(["roughness", "metalness", "emissive"]);
        });

        test("leaves the properties it is not given alone", async () => {
            const { material } = stubDocument();
            material.roughness = 0.7;

            await run("set_material_properties", { id: material.id, properties: { metalness: 1 } });

            expect(material.roughness).toBe(0.7);
            expect(material.metalness).toBe(1);
        });

        test("takes a point for a vector property", async () => {
            const { material } = stubDocument();

            await run("set_material_properties", {
                id: material.id,
                properties: { normalScale: { x: 4, y: 5 } },
            });

            expect(material.normalScale.x).toBe(4);
            expect(material.normalScale.y).toBe(5);
        });

        test("gives a texture slot the image it is handed, and clears it with an empty string", async () => {
            const { material } = stubDocument();

            await run("set_material_properties", {
                id: material.id,
                properties: { roughnessMap: "data:image/png;base64,BBBB" },
            });
            expect(material.roughnessMap.image).toBe("data:image/png;base64,BBBB");

            await run("set_material_properties", { id: material.id, properties: { roughnessMap: "" } });
            expect(material.roughnessMap.image).toBe("");
        });

        test("refuses a property the material does not have, listing the ones it does", async () => {
            const { material } = stubDocument();

            const result = await run("set_material_properties", {
                id: material.id,
                properties: { shininess: 30 },
            });

            expect(result.error).toBe('"shininess" is not a property of this material');
            expect(result.available).toContain("roughness");
        });

        test("refuses a value of the wrong kind", async () => {
            const { material } = stubDocument();

            const result = await run("set_material_properties", {
                id: material.id,
                properties: { roughness: "shiny" },
            });

            expect(result.error).toBe('"roughness" takes a number');
        });

        test("refuses a texture that is not an image source", async () => {
            const { material } = stubDocument();

            const result = await run("set_material_properties", {
                id: material.id,
                properties: { map: 42 },
            });

            expect(result.error).toContain('"map" takes a texture as an image URL');
        });

        test("asks for something to change when the bag is empty", async () => {
            const { material } = stubDocument();

            const result = await run("set_material_properties", { id: material.id, properties: {} });

            expect(result.error).toBe("no properties given");
        });

        test("changes an existing material rather than adding one", async () => {
            const { doc, material } = stubDocument();

            await run("set_material_properties", { id: material.id, properties: { roughness: 0.3 } });

            expect(materials(doc)).toHaveLength(1);
            expect(materials(doc)[0]).toBe(material);
        });
    });
});
