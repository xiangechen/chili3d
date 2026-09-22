// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Contour2D, Vec2 } from "@chili3d/core";
import { type IEdge, type IFace, type IWire, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockShape, setupShapeFactoryMock } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { glyphFaces, type ToWorld } from "../../src/text/outlineToShape";

/** Millimetres per font unit, as a ten-millimetre face of a 1000-unit em would be. */
const scale = 0.01;

const toWorld: ToWorld = (point: Vec2) => new XYZ({ x: point.x * scale, y: point.y * scale, z: 0 });

function loop(points: Vec2[]): Contour2D {
    return {
        start: points[0],
        segments: [
            ...points.slice(1).map((point) => ({ kind: "line" as const, to: point })),
            { kind: "line", to: points[0] },
        ],
    };
}

const rect = (x: number, y: number, size: number) =>
    loop([
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
    ]);

const options = { toWorld, minContourSize: 0.001 };

/** The faces of every piece, for the tests that do not care which solid a face is in. */
const flat = (pieces: IFace[][]) => pieces.flat();

const edgeStub = () => createMockShape({ shapeType: ShapeTypes.edge }) as unknown as IEdge;
const wireStub = () => createMockShape({ shapeType: ShapeTypes.wire }) as unknown as IWire;
const faceStub = () => createMockShape({ shapeType: ShapeTypes.face }) as unknown as IFace;

function spyFactory() {
    return {
        line: rs.fn((_start: XYZ, _end: XYZ): Result<IEdge> => Result.ok(edgeStub())),
        bezier: rs.fn((_points: XYZ[]): Result<IEdge> => Result.ok(edgeStub())),
        wire: rs.fn((_edges: IEdge[]): Result<IWire> => Result.ok(wireStub())),
        face: rs.fn((_wires: IWire[]): Result<IFace> => Result.ok(faceStub())),
    };
}

let spies: ReturnType<typeof spyFactory>;

// `setupShapeFactoryMock` restores the global when the test finishes.
beforeEach(() => {
    spies = spyFactory();
    setupShapeFactoryMock(spies);
});

describe("glyphFaces", () => {
    test("builds one face for a lone contour, as one piece", () => {
        const pieces = glyphFaces([rect(0, 0, 100)], options);

        expect(pieces.length).toBe(1);
        expect(pieces[0].length).toBe(1);
        expect(spies.wire.mock.calls.length).toBe(1);
        expect(spies.face.mock.calls.length).toBe(1);
    });

    test("hands overlapping regions back as one piece, to be fused", () => {
        // `田`'s bars: two regions of one solid, because they cross.
        const across = loop([
            { x: 0, y: 40 },
            { x: 100, y: 40 },
            { x: 100, y: 60 },
            { x: 0, y: 60 },
        ]);
        const down = loop([
            { x: 40, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 100 },
            { x: 40, y: 100 },
        ]);

        const pieces = glyphFaces([across, down], options);

        expect(pieces.length).toBe(1);
        expect(pieces[0].length).toBe(2);
    });

    test("hands regions that do not overlap back as pieces of their own", () => {
        const pieces = glyphFaces([rect(0, 0, 100), rect(500, 500, 100)], options);

        expect(pieces.length).toBe(2);
        expect(pieces.map((piece) => piece.length)).toEqual([1, 1]);
    });

    test("hands a region's outline first and its holes after", () => {
        const built: IWire[] = [];
        spies.wire.mockImplementation(() => {
            const builtWire = wireStub();
            built.push(builtWire);
            return Result.ok(builtWire);
        });

        glyphFaces([rect(0, 0, 100), rect(25, 25, 50)], options);

        const [wires] = spies.face.mock.calls[0];
        // The outer loop is chained first, so the kernel knows which wire is which.
        expect(wires).toEqual([built[0], built[1]]);
        expect(built.length).toBe(2);
        // The two loops are told apart by their starting points, in font units:
        // the outer square starts at (0,0), the counter at (25,25).
        expect(spies.line.mock.calls[0][0]).toEqual(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(spies.line.mock.calls[4][0]).toEqual(new XYZ({ x: 0.25, y: 0.25, z: 0 }));
    });

    test("builds the straight segments of a contour as lines", () => {
        glyphFaces([rect(0, 0, 100)], options);

        expect(spies.line.mock.calls.length).toBe(4);
        expect(spies.bezier.mock.calls.length).toBe(0);
    });

    test("shares each point between the segments that meet there", () => {
        glyphFaces([rect(0, 0, 100)], options);

        const ends = spies.line.mock.calls.map((call) => call[1]);
        const starts = spies.line.mock.calls.map((call) => call[0]);

        expect(ends[0]).toBe(starts[1]);
        expect(ends[1]).toBe(starts[2]);
    });

    test("builds a quadratic segment as a bezier through its control point", () => {
        const curved: Contour2D = {
            start: { x: 0, y: 0 },
            segments: [
                { kind: "quad", c1: { x: 50, y: 100 }, to: { x: 100, y: 0 } },
                { kind: "line", to: { x: 0, y: 0 } },
            ],
        };

        glyphFaces([curved], options);

        const [points] = spies.bezier.mock.calls[0];
        expect(points).toEqual([
            new XYZ({ x: 0, y: 0, z: 0 }),
            new XYZ({ x: 0.5, y: 1, z: 0 }),
            new XYZ({ x: 1, y: 0, z: 0 }),
        ]);
    });

    test("builds a cubic segment as a bezier through both control points", () => {
        const curved: Contour2D = {
            start: { x: 0, y: 0 },
            segments: [
                { kind: "cubic", c1: { x: 20, y: 100 }, c2: { x: 80, y: 100 }, to: { x: 100, y: 0 } },
                { kind: "line", to: { x: 0, y: 0 } },
            ],
        };

        glyphFaces([curved], options);

        const [points] = spies.bezier.mock.calls[0];
        expect(points.length).toBe(4);
        expect(points[1]).toEqual(new XYZ({ x: 0.2, y: 1, z: 0 }));
        expect(points[2]).toEqual(new XYZ({ x: 0.8, y: 1, z: 0 }));
    });

    test("drops a contour too small to bound anything, without asking the kernel", () => {
        const pieces = glyphFaces([rect(0, 0, 0.05)], { ...options, minContourSize: 0.001 });

        expect(flat(pieces).length).toBe(0);
        expect(spies.line.mock.calls.length).toBe(0);
        expect(spies.wire.mock.calls.length).toBe(0);
    });

    test("drops a contour repeated verbatim", () => {
        const pieces = glyphFaces([rect(0, 0, 100), rect(0, 0, 100)], options);

        expect(flat(pieces).length).toBe(1);
        expect(spies.wire.mock.calls.length).toBe(1);
    });

    test("skips a region whose hole will not chain rather than filling it", () => {
        spies.wire
            .mockReturnValueOnce(Result.ok(wireStub()))
            .mockReturnValue(Result.err("Disconnected wire"));

        const pieces = glyphFaces([rect(0, 0, 100), rect(25, 25, 50)], options);

        expect(flat(pieces).length).toBe(0);
        expect(spies.face.mock.calls.length).toBe(0);
    });

    test("keeps the regions that did build when another fails", () => {
        let built = 0;
        spies.face.mockImplementation((_wires: IWire[]) => {
            built += 1;
            return built === 1 ? Result.err("Face Error") : Result.ok(faceStub());
        });

        const pieces = glyphFaces([rect(0, 0, 100), rect(500, 500, 100)], options);

        expect(flat(pieces).length).toBe(1);
        expect(spies.face.mock.calls.length).toBe(2);
    });

    test("skips a contour whose edges the kernel refuses", () => {
        spies.line.mockReturnValue(Result.err("Failed to create edge"));

        const pieces = glyphFaces([rect(0, 0, 100)], options);

        expect(flat(pieces).length).toBe(0);
        expect(spies.wire.mock.calls.length).toBe(0);
    });

    test("returns nothing when the outline has no contours", () => {
        expect(glyphFaces([], options)).toEqual([]);
    });
});
