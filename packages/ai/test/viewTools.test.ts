// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildViewTools, parseColor, parseToolColor } from "../src/tools/viewTools";

describe("parseColor", () => {
    test.each([
        ["#fff", 0xffffff],
        ["#ffffff", 0xffffff],
        ["#0F0", 0x00ff00],
        ["ff8800", 0xff8800],
        ["red", 0xff0000],
    ])("parses %s", (input, expected) => {
        expect(parseColor(input)).toBe(expected);
    });

    test("passes numbers through", () => {
        expect(parseColor(0x123456)).toBe(0x123456);
    });

    test.each([["not-a-color"], ["#12345"], [""], ["#ff00"]])("falls back to gray for %s", (input) => {
        expect(parseColor(input)).toBe(0xcccccc);
    });
});

describe("parseToolColor", () => {
    test("accepts the same forms as parseColor", () => {
        expect(parseToolColor("#ff0000")).toBe(0xff0000);
        expect(parseToolColor("red")).toBe(0xff0000);
        expect(parseToolColor(0x00ff00)).toBe(0x00ff00);
    });

    // The tool's own input path must not swallow a typo as "some gray" the way parseColor does
    // when reading back stored colors.
    test.each([["crimson"], ["#ff00"], [""]])("rejects the unknown color %s", (input) => {
        expect(parseToolColor(input)).toContain("unknown color");
    });

    test("rejects a number outside the 24-bit color range", () => {
        expect(parseToolColor(-1)).toContain("0x000000..0xffffff");
        expect(parseToolColor(0x1000000)).toContain("0x000000..0xffffff");
        expect(parseToolColor(1.5)).toContain("0x000000..0xffffff");
    });
});

describe("set_material tool", () => {
    function getTool() {
        const tool = buildViewTools().find((t) => t.name === "set_material");
        expect(tool).toBeDefined();
        return tool!;
    }

    function stubNode(node: Record<string, unknown> = {}) {
        const doc = createMockDocument();
        const target = { id: "n1", materialId: undefined as string | undefined, ...node };
        (doc.modelManager as any).findNodes = rs.fn((pred: (n: any) => boolean) =>
            pred(target) ? [target] : [],
        );
        (doc.visual as any).update = rs.fn(() => {});
        rs.stubGlobal("app", { activeView: { document: doc } });
        return { doc, target };
    }

    /** The JSON body set_material answers with, success or error. */
    interface MaterialResult {
        id: string;
        color: number;
        opacity: number;
        texture: string | null;
        materialId: string;
        error?: string;
    }

    async function run(args: Record<string, unknown>): Promise<MaterialResult> {
        const result = await getTool().handler(args);
        return JSON.parse(typeof result === "string" ? result : result.content) as MaterialResult;
    }

    /** The materials the document now holds, narrowed for the assertions. */
    function materials(doc: ReturnType<typeof createMockDocument>): any[] {
        return doc.modelManager.materials as unknown as any[];
    }

    afterEach(() => {
        rs.unstubAllGlobals();
    });

    test("sets colour, opacity and texture together on a new material", async () => {
        const { doc, target } = stubNode();

        const result = await run({
            id: "n1",
            color: "#ff0000",
            opacity: 0.4,
            texture: "data:image/png;base64,AAAA",
        });

        expect(result).toMatchObject({ id: "n1", color: 0xff0000, opacity: 0.4 });
        const created = materials(doc);
        expect(created).toHaveLength(1);
        expect(created[0].opacity).toBe(0.4);
        expect(created[0].map.image).toBe("data:image/png;base64,AAAA");
        expect(target.materialId).toBe(created[0].id);
    });

    test("keeps the values it is not given, and reuses a material that already matches", async () => {
        const { doc } = stubNode();
        await run({ id: "n1", color: "red" });

        const result = await run({ id: "n1", opacity: 0.5 });

        expect(result.color).toBe(0xff0000);
        expect(materials(doc)).toHaveLength(2);
        // Asking again for the same appearance must not pile up another material.
        await run({ id: "n1", color: "red", opacity: 0.5 });
        expect(materials(doc)).toHaveLength(2);
    });

    test("validates opacity, the texture source and an empty call", async () => {
        stubNode();

        expect((await run({ id: "n1", opacity: 2 })).error).toContain("opacity must be a number in [0,1]");
        expect((await run({ id: "n1", texture: "checkerboard" })).error).toContain(
            "texture must be an image data URL",
        );
        expect((await run({ id: "n1" })).error).toContain("provide at least one of color, opacity, texture");
    });

    test("removes a texture with an empty string", async () => {
        const { doc } = stubNode();
        await run({ id: "n1", texture: "data:image/png;base64,AAAA" });

        const result = await run({ id: "n1", texture: "" });

        expect(result.texture).toBeNull();
        expect(materials(doc)[1].map.image).toBe("");
    });
});

describe("fit_content tool", () => {
    afterEach(() => {
        rs.unstubAllGlobals();
    });

    function getTool() {
        const tool = buildViewTools().find((t) => t.name === "fit_content");
        expect(tool).toBeDefined();
        return tool!;
    }

    test("calls fitContent on the active view's camera controller", async () => {
        const fitContent = rs.fn();
        const update = rs.fn();
        rs.stubGlobal("app", { activeView: { cameraController: { fitContent }, update } });

        const result = (await getTool().handler({})) as { content: string };

        expect(fitContent).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(JSON.parse(result.content)).toEqual({ ok: true });
    });

    test("reports an error when there is no active view", async () => {
        rs.stubGlobal("app", { activeView: undefined });

        const result = (await getTool().handler({})) as { content: string };

        expect(JSON.parse(result.content)).toEqual({ error: "no active view" });
    });
});

describe("rotate_view tool", () => {
    afterEach(() => {
        rs.unstubAllGlobals();
    });

    function getTool() {
        const tool = buildViewTools().find((t) => t.name === "rotate_view");
        expect(tool).toBeDefined();
        return tool!;
    }

    function stubView(position: { x: number; y: number; z: number }, target = { x: 0, y: 0, z: 0 }) {
        const lookAt = rs.fn();
        const update = rs.fn();
        rs.stubGlobal("app", {
            activeView: {
                cameraController: { cameraPosition: position, cameraTarget: target, lookAt },
                update,
            },
        });
        return { lookAt, update };
    }

    test("preset top view places the camera straight above the target, keeping distance", async () => {
        const { lookAt, update } = stubView({ x: 30, y: -40, z: 0 });

        const result = (await getTool().handler({ view: "top" })) as { content: string };

        expect(lookAt).toHaveBeenCalledTimes(1);
        const [eye, target, up] = lookAt.mock.calls[0];
        expect(eye).toEqual({ x: 0, y: 0, z: 50 });
        expect(target).toEqual({ x: 0, y: 0, z: 0 });
        expect(up).toEqual({ x: 0, y: 1, z: 0 });
        expect(update).toHaveBeenCalledTimes(1);
        expect(JSON.parse(result.content)).toEqual({ ok: true, eye: { x: 0, y: 0, z: 50 } });
    });

    test("relative azimuth orbits the camera around the Z axis", async () => {
        const { lookAt } = stubView({ x: 10, y: 0, z: 0 });

        await getTool().handler({ azimuth: 90 });

        const [eye, , up] = lookAt.mock.calls[0];
        expect(eye.x).toBeCloseTo(0, 6);
        expect(eye.y).toBeCloseTo(10, 6);
        expect(eye.z).toBeCloseTo(0, 6);
        expect(up).toEqual({ x: 0, y: 0, z: 1 });
    });

    test("elevation is clamped away from the poles", async () => {
        const { lookAt } = stubView({ x: 0, y: 0, z: 5 });

        await getTool().handler({ elevation: 180 });

        const [eye] = lookAt.mock.calls[0];
        const horizontal = Math.hypot(eye.x, eye.y);
        expect(horizontal).toBeGreaterThan(0);
        expect(eye.z).toBeCloseTo(Math.sin((89.9 * Math.PI) / 180) * 5, 3);
    });

    test("rejects when neither view nor angles are given, and on unknown presets", async () => {
        stubView({ x: 1, y: 0, z: 0 });

        const missing = (await getTool().handler({})) as { content: string };
        expect(JSON.parse(missing.content)).toEqual({ error: "provide view or azimuth/elevation" });

        const unknown = (await getTool().handler({ view: "isometric" })) as { content: string };
        expect(JSON.parse(unknown.content).error).toContain("unknown view");
    });

    test("reports an error when there is no active view", async () => {
        rs.stubGlobal("app", { activeView: undefined });

        const result = (await getTool().handler({ view: "iso" })) as { content: string };

        expect(JSON.parse(result.content)).toEqual({ error: "no active view" });
    });
});

describe("isolate_view tool", () => {
    afterEach(() => {
        rs.unstubAllGlobals();
    });

    function getTool() {
        const tool = buildViewTools().find((t) => t.name === "isolate_view");
        expect(tool).toBeDefined();
        return tool!;
    }

    function stubView(nodeIds: string[] = []) {
        const order: string[] = [];
        const isolate = rs.fn((_nodes: unknown[]) => {
            order.push("isolate");
        });
        const unisolate = rs.fn(() => {
            order.push("unisolate");
        });
        const update = rs.fn();
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn((pred: (n: any) => boolean) =>
            nodeIds.map((id) => ({ id })).filter(pred),
        );
        rs.stubGlobal("app", { activeView: { document: doc, isolate, unisolate, update } });
        return { isolate, unisolate, update, order };
    }

    test("isolates the given nodes, clearing any previous isolation first", async () => {
        const { isolate, update, order } = stubView(["n1", "n2"]);

        const result = (await getTool().handler({ ids: ["n1", "n2"] })) as { content: string };

        // The viewport's isolate() widens the existing isolation; this tool is documented as
        // replacing it, so the previous set is dropped before the new one is applied.
        expect(order).toEqual(["unisolate", "isolate"]);
        expect(isolate.mock.calls[0][0]).toEqual([{ id: "n1" }, { id: "n2" }]);
        expect(update).toHaveBeenCalledTimes(1);
        expect(JSON.parse(result.content)).toEqual({ ok: true, isolated: ["n1", "n2"] });
    });

    test("an empty ids array clears the isolation", async () => {
        const { isolate, unisolate } = stubView();

        const result = (await getTool().handler({ ids: [] })) as { content: string };

        expect(unisolate).toHaveBeenCalledTimes(1);
        expect(isolate).not.toHaveBeenCalled();
        expect(JSON.parse(result.content)).toEqual({ ok: true, isolated: [] });
    });

    test("reports an error for unknown node ids", async () => {
        const { isolate } = stubView(["n1"]);

        const result = (await getTool().handler({ ids: ["n1", "ghost"] })) as { content: string };

        expect(isolate).not.toHaveBeenCalled();
        expect(JSON.parse(result.content).error).toContain("ghost");
    });

    test("reports an error when there is no document", async () => {
        rs.stubGlobal("app", { activeView: undefined });

        const result = (await getTool().handler({ ids: ["n1"] })) as { content: string };

        expect(JSON.parse(result.content).error).toBeDefined();
    });
});

describe("set_camera_type tool", () => {
    afterEach(() => {
        rs.unstubAllGlobals();
    });

    function getTool() {
        const tool = buildViewTools().find((t) => t.name === "set_camera_type");
        expect(tool).toBeDefined();
        return tool!;
    }

    function stubView(initial: string) {
        const cameraController = { cameraType: initial };
        const update = rs.fn();
        rs.stubGlobal("app", { activeView: { cameraController, update } });
        return { cameraController, update };
    }

    test("switches to the requested projection", async () => {
        const { cameraController, update } = stubView("perspective");

        const result = (await getTool().handler({ type: "orthographic" })) as { content: string };

        expect(cameraController.cameraType).toBe("orthographic");
        expect(update).toHaveBeenCalledTimes(1);
        expect(JSON.parse(result.content)).toEqual({ ok: true, cameraType: "orthographic" });
    });

    test("toggles between perspective and orthographic when type is omitted", async () => {
        const { cameraController } = stubView("orthographic");

        const result = (await getTool().handler({})) as { content: string };

        expect(cameraController.cameraType).toBe("perspective");
        expect(JSON.parse(result.content)).toEqual({ ok: true, cameraType: "perspective" });
    });

    test("rejects an unknown camera type", async () => {
        const { cameraController } = stubView("perspective");

        const result = (await getTool().handler({ type: "fisheye" })) as { content: string };

        expect(JSON.parse(result.content).error).toContain('unknown camera type "fisheye"');
        expect(cameraController.cameraType).toBe("perspective");
    });

    test("reports an error when there is no active view", async () => {
        rs.stubGlobal("app", { activeView: undefined });

        const result = (await getTool().handler({ type: "orthographic" })) as { content: string };

        expect(JSON.parse(result.content)).toEqual({ error: "no active view" });
    });
});
