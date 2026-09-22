// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    cacheOfOutline,
    type FontOutline,
    type IDocument,
    Plane,
    Result,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { TextNode } from "../../src/bodys/text";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

/** A font whose one glyph is a square, so the shape has something to extrude. */
const square = [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
    { x: 500, y: 700 },
    { x: 0, y: 700 },
];

function fontOf(advance = 600): FontOutline {
    return {
        familyName: "fake",
        unitsPerEm: 1000,
        missingAdvance: 500,
        glyph: (codePoint) =>
            codePoint === 0x41
                ? {
                      advance,
                      contours: [
                          {
                              start: square[0],
                              segments: [
                                  { kind: "line", to: square[1] },
                                  { kind: "line", to: square[2] },
                                  { kind: "line", to: square[3] },
                                  { kind: "line", to: square[0] },
                              ],
                          },
                      ],
                  }
                : undefined,
    };
}

const outlinesFor = (text: string) =>
    JSON.stringify(
        cacheOfOutline(
            fontOf(),
            [...text].map((character) => character.codePointAt(0)!),
        ),
    );

function nodeOptions(doc: IDocument, text = "A") {
    return {
        document: doc,
        plane: Plane.XY,
        text,
        size: 10,
        depth: 2,
        fontName: "fake",
        fontUrl: "",
        outlines: outlinesFor(text),
    };
}

let doc: IDocument;
let spies: {
    line: ReturnType<typeof rs.fn>;
    wire: ReturnType<typeof rs.fn>;
    face: ReturnType<typeof rs.fn>;
    combine: ReturnType<typeof rs.fn>;
    prism: ReturnType<typeof rs.fn>;
};

beforeEach(() => {
    doc = createMockDocument();
    spies = {
        line: rs.fn(() => Result.ok(createMockShape({ shapeType: ShapeTypes.edge }))),
        wire: rs.fn(() => Result.ok(createMockShape({ shapeType: ShapeTypes.wire }))),
        face: rs.fn(() => Result.ok(createMockShape({ shapeType: ShapeTypes.face }))),
        combine: rs.fn(() => Result.ok(createMockShape({ shapeType: ShapeTypes.compound }))),
        prism: rs.fn(() => Result.ok(createMockShape())),
    };
    setupShapeFactoryMock(spies);
});

describe("TextNode", () => {
    test("names the node body.text", () => {
        const node = new TextNode(nodeOptions(doc));

        expect(node.display()).toBe("body.text");
        expect(node.name).toBe("body.text1");
    });

    test("keeps the text, size, depth and font it was made with", () => {
        const node = new TextNode(nodeOptions(doc));

        expect(node.text).toBe("A");
        expect(node.size).toBe(10);
        expect(node.depth).toBe(2);
        expect(node.fontName).toBe("fake");
        expect(node.fontUrl).toBe("");
    });

    test("builds a solid from its own outlines, without reaching for any font", () => {
        const fetchMock = rs.fn();
        rs.stubGlobal("fetch", fetchMock);
        const node = new TextNode(nodeOptions(doc));

        const shape = node.shape;

        // The outlines the node carries are the whole of what a shape needs.
        expect(fetchMock.mock.calls.length).toBe(0);
        expect(shape.isOk).toBe(true);
        expect(spies.line.mock.calls.length).toBe(4);
        // The square as the text flat, and the bodies the line is extruded as.
        expect(spies.combine.mock.calls.length).toBe(2);
        // The square is extruded by the depth along the plane's normal.
        expect(spies.prism.mock.calls.length).toBe(1);
        expect(spies.prism.mock.calls[0][1]).toEqual(new XYZ({ x: 0, y: 0, z: 2 }));
    });

    test("reports an error rather than throwing when it has no outlines", () => {
        const node = new TextNode({ ...nodeOptions(doc), outlines: "" });

        const shape = node.shape;

        expect(shape.isOk).toBe(false);
        expect(shape.error).toContain("no font");
    });

    test("reports an error when its outlines are not readable", () => {
        const node = new TextNode({ ...nodeOptions(doc), outlines: "{ not json" });

        const shape = node.shape;

        expect(shape.isOk).toBe(false);
        expect(shape.error).toContain("could not be read");
    });

    test("reports an error when the text has nothing to draw", () => {
        const node = new TextNode({ ...nodeOptions(doc), text: "" });

        const shape = node.shape;

        expect(shape.isOk).toBe(false);
        expect(shape.error).toContain("no text");
    });

    test("moving the location moves the plane the text lies on", () => {
        const node = new TextNode(nodeOptions(doc));

        node.location = new XYZ({ x: 5, y: 6, z: 7 });

        expect(node.plane.origin).toEqual(new XYZ({ x: 5, y: 6, z: 7 }));
        expect(node.location).toEqual(new XYZ({ x: 5, y: 6, z: 7 }));
    });

    test("drawing in a font replaces the outlines and names the font", () => {
        const node = new TextNode(nodeOptions(doc));
        const before = node.outlines;

        node.drawIn("Roboto", "https://cdn.example/roboto.ttf", fontOf(900));

        expect(node.fontName).toBe("Roboto");
        expect(node.fontUrl).toBe("https://cdn.example/roboto.ttf");
        expect(node.outlines).not.toBe(before);
        expect(node.outlines).toContain("900");
    });

    test("keeps the font's address, since that is what lays the text out again", () => {
        const node = new TextNode(nodeOptions(doc));

        node.drawIn("Noto Sans SC", "https://cdn.example/sc.ttf", fontOf());

        expect(node.fontUrl).toBe("https://cdn.example/sc.ttf");
    });

    test("refuses a font it cannot get hold of, rather than drawing nothing", async () => {
        // A font off a disk, in a session that never parsed it: there is nothing
        // to lay the text out with and no address to fetch.
        const node = new TextNode(nodeOptions(doc));

        const done = await node.useFont({ name: "Mine.ttf", data: "not a data url" });

        expect(done.isOk).toBe(false);
        expect(done.error).toContain("not readable");
    });
});
