// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type I18nKeys,
    type IDocument,
    PubSub,
    property,
    VisualNode,
    XY,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildPropertyTools } from "../src/tools/propertyTools";

/**
 * A node shaped like the app's own body nodes — @property accessors over getPrivateValue, the
 * same declarations the property panel renders. (A real BoxNode would drag in the WASM shape
 * factory, which is what its dx setter regenerates through; the tool only depends on the
 * accessor being there.)
 */
class PlateNode extends VisualNode {
    constructor(document: IDocument, name = "plate", id = "n1") {
        super(document, name, id);
    }

    display(): I18nKeys {
        return "body.box" as I18nKeys;
    }

    boundingBox() {
        return new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }

    @property("box.dx")
    get dx(): number {
        return this.getPrivateValue("dx", 10);
    }
    set dx(value: number) {
        this.setProperty("dx", value);
    }

    @property("common.location")
    get location(): XYZ {
        return this.getPrivateValue("location", new XYZ({ x: 0, y: 0, z: 0 }));
    }
    set location(value: XYZ) {
        this.setProperty("location", value);
    }

    @property("common.material", { type: "materialId" })
    get materialId(): string {
        return this.getPrivateValue("materialId", "");
    }
    set materialId(value: string) {
        this.setProperty("materialId", value);
    }

    @property("circle.radius")
    get corner(): XY {
        return this.getPrivateValue("corner", new XY(1, 2));
    }
    set corner(value: XY) {
        this.setProperty("corner", value);
    }

    /** Getter without a setter: the panel renders it read-only, and so does the tool. */
    @property("common.shapeType")
    get shapeType(): string {
        return "solid";
    }
}

function getTool(name: string) {
    const tool = buildPropertyTools().find((t) => t.name === name);
    expect(tool).toBeDefined();
    return tool!;
}

function stubDocument(document: IDocument, nodes: VisualNode[], selected: VisualNode[] = []) {
    (document.modelManager as unknown as { findNodes: unknown }).findNodes = rs.fn(() => nodes);
    (document.selection as unknown as { getSelectedNodes: unknown }).getSelectedNodes = rs.fn(() => selected);
    (document as unknown as { visual: { update: unknown } }).visual.update = rs.fn(() => {});

    const app = createMockApplication();
    (app as unknown as { activeView: unknown }).activeView = { document };
    rs.stubGlobal("app", app);
}

afterEach(() => {
    rs.unstubAllGlobals();
});

describe("get_node_properties", () => {
    test("reports the properties the panel shows, with their kinds and current values", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node]);

        const result = JSON.parse((await getTool("get_node_properties").handler({ ids: ["n1"] })) as string);

        expect(result.nodes).toHaveLength(1);
        const [reported] = result.nodes;
        expect(reported.id).toBe("n1");
        expect(reported.name).toBe("plate");
        expect(reported.properties).toContainEqual({
            name: "dx",
            label: "box.dx",
            kind: "number",
            value: 10,
        });
        // A point property carries its components, and a getter-only one is marked read-only
        // so the model does not try to write it.
        expect(reported.properties).toContainEqual({
            name: "location",
            label: "common.location",
            kind: "xyz",
            value: { x: 0, y: 0, z: 0 },
        });
        expect(reported.properties).toContainEqual({
            name: "corner",
            label: "circle.radius",
            kind: "xy",
            value: { x: 1, y: 2 },
        });
        expect(reported.properties).toContainEqual({
            name: "shapeType",
            label: "common.shapeType",
            kind: "string",
            value: "solid",
            readOnly: true,
        });
    });

    test("defaults to the selected nodes", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node], [node]);

        const result = JSON.parse((await getTool("get_node_properties").handler({})) as string);

        expect(result.nodes[0].name).toBe("plate");
    });

    test("asks for ids when nothing is given and nothing is selected", async () => {
        const doc = createMockDocument();
        stubDocument(doc, []);

        const result = JSON.parse((await getTool("get_node_properties").handler({})) as string);

        expect(result.error).toContain("nothing is selected");
        expect(result.error).toContain("get_document_state");
    });
});

describe("set_node_properties", () => {
    test("writes a shape parameter and reports the new value", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node]);

        const result = JSON.parse(
            (await getTool("set_node_properties").handler({ id: "n1", properties: { dx: 25 } })) as string,
        );

        expect(node.dx).toBe(25);
        expect(result.updated).toEqual([{ name: "dx", label: "box.dx", kind: "number", value: 25 }]);
    });

    test("republishes the property panel, which selection changes alone would not refresh", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node], [node]);
        const pub = rs.spyOn(PubSub.default, "pub");

        try {
            await getTool("set_node_properties").handler({ id: "n1", properties: { dx: 25 } });

            expect(pub).toHaveBeenCalledWith("showProperties", doc, [node]);
        } finally {
            pub.mockRestore();
        }
    });

    test("writes a node name", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node]);

        const result = JSON.parse(
            (await getTool("set_node_properties").handler({
                id: "n1",
                properties: { name: "base plate" },
            })) as string,
        );

        expect(node.name).toBe("base plate");
        expect(result.updated[0].value).toBe("base plate");
    });

    test("builds the geometry class a point property expects", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node]);

        await getTool("set_node_properties").handler({
            id: "n1",
            properties: { location: { x: 1, y: 2, z: 3 }, corner: { x: 4, y: 5 } },
        });

        expect(node.location).toBeInstanceOf(XYZ);
        expect([node.location.x, node.location.y, node.location.z]).toEqual([1, 2, 3]);
        expect(node.corner).toBeInstanceOf(XY);
        expect([node.corner.x, node.corner.y]).toEqual([4, 5]);
    });

    test("rejects an unknown property and lists the ones that exist", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node]);

        const result = JSON.parse(
            (await getTool("set_node_properties").handler({ id: "n1", properties: { height: 3 } })) as string,
        );

        expect(result.error).toContain('"height" is not a property');
        expect(result.available).toContain("dx");
        expect(node.dx).toBe(10);
    });

    test("rejects a read-only property instead of silently doing nothing", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node]);

        const result = JSON.parse(
            (await getTool("set_node_properties").handler({
                id: "n1",
                properties: { shapeType: "wire" },
            })) as string,
        );

        expect(result.error).toContain('"shapeType" is read-only');
    });

    test("rejects a value of the wrong kind", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        stubDocument(doc, [node]);

        const result = JSON.parse(
            (await getTool("set_node_properties").handler({ id: "n1", properties: { dx: "20" } })) as string,
        );

        expect(result.error).toContain("takes a number");
        expect(node.dx).toBe(10);
    });

    test("validates a material assignment against the document's materials", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        (doc.modelManager as unknown as { materials: unknown[] }).materials = [{ id: "steel" }];
        stubDocument(doc, [node]);

        const rejected = JSON.parse(
            (await getTool("set_node_properties").handler({
                id: "n1",
                properties: { materialId: "unobtanium" },
            })) as string,
        );

        expect(rejected.error).toContain("steel");
    });

    test("refuses a tool node consumed by a body, whose own features are what drives the model", async () => {
        const doc = createMockDocument();
        const node = new PlateNode(doc);
        // A parent that is not a FolderNode means the node was consumed by it (a boolean
        // operand, a body's tool). The body rebuilds from featuresJson, never from this node.
        (node as unknown as { parent: unknown }).parent = { name: "Body", id: "b1" };
        stubDocument(doc, [node]);

        const written = JSON.parse(
            (await getTool("set_node_properties").handler({ id: "n1", properties: { dx: 25 } })) as string,
        );
        const read = JSON.parse((await getTool("get_node_properties").handler({ ids: ["n1"] })) as string);

        expect(written.error).toContain("consumed tool");
        expect(written.error).toContain("Body");
        expect(node.dx).toBe(10);
        expect(read.nodes[0].note).toContain("Body");
    });

    test("reports a missing node with the same self-healing hint the other tools give", async () => {
        const doc = createMockDocument();
        stubDocument(doc, []);

        const result = JSON.parse(
            (await getTool("set_node_properties").handler({ id: "gone", properties: { dx: 1 } })) as string,
        );

        expect(result.error).toContain("node not found: gone");
    });
});
