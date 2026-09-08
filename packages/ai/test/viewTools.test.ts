// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildViewTools, parseColor } from "../src/tools/viewTools";

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
        const isolate = rs.fn();
        const unisolate = rs.fn();
        const update = rs.fn();
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn((pred: (n: any) => boolean) =>
            nodeIds.map((id) => ({ id })).filter(pred),
        );
        rs.stubGlobal("app", { activeView: { document: doc, isolate, unisolate, update } });
        return { isolate, unisolate, update };
    }

    test("isolates the given nodes", async () => {
        const { isolate, update } = stubView(["n1", "n2"]);

        const result = (await getTool().handler({ ids: ["n1", "n2"] })) as { content: string };

        expect(isolate).toHaveBeenCalledTimes(1);
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
