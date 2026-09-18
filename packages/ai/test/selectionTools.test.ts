// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeTypes, VisualStates } from "@chili3d/core";
import { rs } from "@rstest/core";
import { buildSelectionTools } from "../src/tools/selectionTools";

function getTool(name: string) {
    const tool = buildSelectionTools().find((t) => t.name === name);
    expect(tool).toBeDefined();
    return tool!;
}

function fakeShapeHit(overrides: Record<string, unknown> = {}) {
    return {
        shape: { shapeType: ShapeTypes.edge, index: 3 },
        owner: { node: { id: "n1", name: "box" } },
        indexes: [3],
        point: { x: 1, y: 2, z: 3 },
        ...overrides,
    };
}

afterEach(() => {
    rs.unstubAllGlobals();
});

describe("click_view tool", () => {
    function stubView(detectShapes: unknown, setSelectedShapes?: unknown, toImage?: unknown) {
        rs.stubGlobal("app", {
            activeView: {
                dom: {},
                width: 800,
                height: 600,
                detectShapes,
                toImage,
                document: { selection: { setSelectedShapes } },
            },
        });
    }

    test("detect scales normalized coordinates and reports candidates", async () => {
        const hits = [fakeShapeHit()];
        const detectShapes = rs.fn((_t: number, _x: number, _y: number) => hits);
        stubView(detectShapes);

        const result = JSON.parse(
            (await getTool("click_view").handler({ x: 0.5, y: 0.25, shapeType: "edge" })) as string,
        );

        expect(detectShapes.mock.calls[0]).toEqual([ShapeTypes.edge, 400, 150]);
        expect(result.pixel).toEqual({ x: 400, y: 150 });
        expect(result.hits).toHaveLength(1);
        expect(result.hits[0]).toEqual({
            nodeId: "n1",
            nodeName: "box",
            shapeType: "edge",
            index: 3,
            point: { x: 1, y: 2, z: 3 },
        });
        expect(result.selected).toBeUndefined();
    });

    test("select picks the first hit with the face selected state", async () => {
        const faceHit = fakeShapeHit({ shape: { shapeType: ShapeTypes.face, index: 1 }, indexes: [1] });
        const detectShapes = rs.fn(() => [faceHit, fakeShapeHit()]);
        const setSelectedShapes = rs.fn();
        stubView(detectShapes, setSelectedShapes);

        const result = JSON.parse(
            (await getTool("click_view").handler({ x: 0.1, y: 0.9, action: "select" })) as string,
        );

        expect(setSelectedShapes).toHaveBeenCalledTimes(1);
        expect(setSelectedShapes.mock.calls[0][0]).toEqual([faceHit]);
        expect(setSelectedShapes.mock.calls[0][1]).toBe(VisualStates.faceSelected);
        expect(setSelectedShapes.mock.calls[0][2]).toBe(false);
        expect(result.selected.shapeType).toBe("face");
        expect(result.hits).toHaveLength(2);
    });

    test("rejects out-of-range coordinates", async () => {
        stubView(rs.fn(() => []));
        const result = JSON.parse((await getTool("click_view").handler({ x: 1.2, y: 0 })) as string);
        expect(result.error).toContain("must be numbers in [0,1]");
    });

    test("screenshot:true returns the viewport image with the select result", async () => {
        const faceHit = fakeShapeHit({ shape: { shapeType: ShapeTypes.face, index: 1 }, indexes: [1] });
        const toImage = rs.fn(() => "data:image/png;base64,AAAA");
        stubView(
            rs.fn(() => [faceHit]),
            rs.fn(),
            toImage,
        );

        const result = (await getTool("click_view").handler({
            x: 0.5,
            y: 0.5,
            action: "select",
            screenshot: true,
        })) as { content: string; images?: { mediaType: string; data: string }[] };

        expect(toImage).toHaveBeenCalledTimes(1);
        expect(result.images).toEqual([{ mediaType: "image/png", data: "AAAA" }]);
        const payload = JSON.parse(result.content);
        expect(payload.screenshot).toBe(true);
        expect(payload.mediaType).toBe("image/png");
        expect(payload.selected.shapeType).toBe("face");
    });

    test("omits the image unless it is asked for", async () => {
        const toImage = rs.fn(() => "data:image/png;base64,AAAA");
        stubView(
            rs.fn(() => [fakeShapeHit()]),
            rs.fn(),
            toImage,
        );

        const result = await getTool("click_view").handler({ x: 0.5, y: 0.5, action: "select" });

        expect(toImage).not.toHaveBeenCalled();
        expect(typeof result).toBe("string");
    });
});

describe("select_nodes tool", () => {
    test("selects found nodes and reports missing ids", async () => {
        const nodeA = { id: "a", name: "A" };
        const setSelectedNodes = rs.fn();
        rs.stubGlobal("app", {
            activeView: {
                document: {
                    modelManager: {
                        findNodes: (pred: (n: { id: string }) => boolean) => [nodeA].filter(pred),
                    },
                    selection: { setSelectedNodes },
                },
            },
        });

        const result = JSON.parse(
            (await getTool("select_nodes").handler({ nodeIds: ["a", "gone"] })) as string,
        );

        expect(setSelectedNodes.mock.calls[0][0]).toEqual([nodeA]);
        expect(setSelectedNodes.mock.calls[0][1]).toBe(false);
        expect(result.selected).toEqual([{ id: "a", type: "Object", name: "A" }]);
        expect(result.missing).toEqual(["gone"]);
    });

    test("empty array clears the selection", async () => {
        const setSelectedNodes = rs.fn();
        rs.stubGlobal("app", {
            activeView: {
                document: {
                    modelManager: { findNodes: () => [] },
                    selection: { setSelectedNodes },
                },
            },
        });

        const result = JSON.parse((await getTool("select_nodes").handler({ nodeIds: [] })) as string);

        expect(setSelectedNodes.mock.calls[0][0]).toEqual([]);
        expect(result).toEqual({ selected: [], missing: [] });
    });
});
