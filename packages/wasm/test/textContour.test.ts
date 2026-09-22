// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Contour2D,
    CurveUtils,
    type FontOutline,
    type GlyphOutline,
    type IApplication,
    type IEdge,
    type IFace,
    type IWire,
    Plane,
    ShapeTypes,
    setCurrentApplication,
    textShape,
    textSolid,
    XYZ,
} from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import { createTestConverter, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

const p = (x: number, y: number) => new XYZ({ x, y, z: 0 });

/**
 * The shape of a glyph contour a font hands us: a closed loop of straight and
 * quadratic segments. `quad` carries its control point, so the edge keeps the
 * curve instead of flattening to a polyline.
 */
type Segment = { kind: "line"; to: XYZ } | { kind: "quad"; c1: XYZ; to: XYZ };

const line = (to: XYZ): Segment => ({ kind: "line", to });
const quad = (c1: XYZ, to: XYZ): Segment => ({ kind: "quad", c1, to });

interface Contour {
    start: XYZ;
    segments: Segment[];
}

/**
 * Build a contour's edges, sharing each point between the segments that meet
 * there: `wire` chains edges only within `Precision::Confusion()`, so a point
 * recomputed on both sides of a join can leave the loop unclosed.
 */
function contourEdges(contour: Contour): IEdge[] {
    const edges: IEdge[] = [];
    let from = contour.start;
    for (const segment of contour.segments) {
        const result =
            segment.kind === "line"
                ? factory.line(from, segment.to)
                : factory.bezier([from, segment.c1, segment.to]);
        edges.push(unwrapOk(result));
        from = segment.to;
    }
    return edges;
}

function contourWire(contour: Contour): IWire {
    return unwrapOk(factory.wire(contourEdges(contour)));
}

function faceOf(contours: Contour[]): IFace {
    return unwrapOk(factory.face(contours.map(contourWire)));
}

/** The same loop walked the other way round; a bezier keeps its control points. */
function reversed(contour: Contour): Contour {
    const points = [contour.start, ...contour.segments.map((segment) => segment.to)];
    return {
        start: points[points.length - 1],
        segments: [...contour.segments]
            .reverse()
            .map((segment, index) => ({ ...segment, to: points[points.length - 2 - index] })),
    };
}

/** Counter-clockwise rectangle, given its lower-left corner. */
function rectContour(x: number, y: number, dx: number, dy: number): Contour {
    return {
        start: p(x, y),
        segments: [line(p(x + dx, y)), line(p(x + dx, y + dy)), line(p(x, y + dy)), line(p(x, y))],
    };
}

/**
 * A circle built the way a font builds one: four quadratic arcs, each with its
 * control point on the corner. Counter-clockwise, and already closed.
 */
function circleContour(cx: number, cy: number, r: number): Contour {
    const right = p(cx + r, cy);
    return {
        start: right,
        segments: [
            quad(p(cx + r, cy + r), p(cx, cy + r)),
            quad(p(cx - r, cy + r), p(cx - r, cy)),
            quad(p(cx - r, cy - r), p(cx, cy - r)),
            quad(p(cx + r, cy - r), right),
        ],
    };
}

/** Shoelace area of a contour, sampled off its quadratic segments. */
function sampledArea(contour: Contour, steps = 400): number {
    const points: XYZ[] = [contour.start];
    let from = contour.start;
    for (const segment of contour.segments) {
        if (segment.kind === "line") {
            points.push(segment.to);
        } else {
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const u = 1 - t;
                points.push(
                    new XYZ({
                        x: u * u * from.x + 2 * u * t * segment.c1.x + t * t * segment.to.x,
                        y: u * u * from.y + 2 * u * t * segment.c1.y + t * t * segment.to.y,
                        z: 0,
                    }),
                );
            }
        }
        from = segment.to;
    }

    let twice = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        twice += a.x * b.y - b.x * a.y;
    }
    return Math.abs(twice) / 2;
}

const height = 10;
const up = new XYZ({ x: 0, y: 0, z: height });
const rectArea = (dx: number, dy: number) => dx * dy;

describe("glyph contour — chaining a closed loop", () => {
    test("a contour with its closing segment omitted chains into an open wire", () => {
        const rect = rectContour(0, 0, 100, 100);
        const opened: Contour = { start: rect.start, segments: rect.segments.slice(0, 3) };

        const wire = unwrapOk(factory.wire(contourEdges(opened)));

        // A connected but unclosed chain is still a valid wire — which is why a
        // missing closing segment would silently extrude to a shell, not a solid.
        expect(wire.shapeType).toBe(ShapeTypes.wire);
        expect(wire.isClosed()).toBe(false);
    });

    test("the same contour closes once the closing segment is provided", () => {
        const wire = contourWire(rectContour(0, 0, 100, 100));

        expect(wire.shapeType).toBe(ShapeTypes.wire);
        expect(wire.isClosed()).toBe(true);
    });

    test("an unclosed contour is caught by isClosed(), not by face or prism", () => {
        const rect = rectContour(0, 0, 100, 100);
        const opened: Contour = { start: rect.start, segments: rect.segments.slice(0, 3) };

        const wire = unwrapOk(factory.wire(contourEdges(opened)));
        expect(wire.isClosed()).toBe(false);

        // Neither face() nor prism() refuses an open contour — they build a
        // bogus solid instead. Closure has to be checked before the kernel
        // sees the contour, which is why every contour gets an implicit
        // closing segment.
        expect(factory.face([wire]).isOk).toBe(true);
        expect(factory.prism(faceOf([opened]), up).isOk).toBe(true);
    });
});

describe("glyph contour — a face with a hole", () => {
    test("straight outer and hole yield the exact ring volume", () => {
        const face = faceOf([rectContour(0, 0, 100, 100), rectContour(30, 30, 40, 40)]);

        expect(face.findSubShapes(ShapeTypes.wire).length).toBe(2);
        expect(face.mesh.faces?.position.length ?? 0).toBeGreaterThan(0);

        const ring = unwrapOk(factory.prism(face, up));
        expect(ring.volume()).toBeCloseTo((rectArea(100, 100) - rectArea(40, 40)) * height, 6);
    });

    test("curved outer and hole keep the curves and the hole", () => {
        const outer = circleContour(50, 50, 40);
        const inner = circleContour(50, 50, 15);

        const face = faceOf([outer, inner]);
        expect(face.findSubShapes(ShapeTypes.wire).length).toBe(2);
        expect(face.mesh.faces?.position.length ?? 0).toBeGreaterThan(0);

        const expectedRing = (sampledArea(outer) - sampledArea(inner)) * height;
        const expectedSolid = sampledArea(outer) * height;
        const ringVolume = unwrapOk(factory.prism(face, up)).volume();
        const solidVolume = unwrapOk(factory.prism(faceOf([outer]), up)).volume();

        expect(ringVolume).toBeCloseTo(expectedRing, 0);
        expect(solidVolume).toBeCloseTo(expectedSolid, 0);
        expect(ringVolume).toBeLessThan(solidVolume);
    });

    test("a curved segment is a bezier edge, not a flattened polyline", () => {
        const edges = contourEdges(circleContour(50, 50, 40));
        const curve = edges[0].curve;
        const basis = CurveUtils.isTrimmed(curve) ? curve.basisCurve : curve;

        expect(basis.curveType).toBe("bezierCurve");
    });

    test.each([
        ["both wound the same way", false, false],
        ["the hole wound against the outline", true, false],
        ["the outline wound against the hole", false, true],
        ["both wound against each other", true, true],
    ])("a hole is cut out when %s", (_name, reverseOuter, reverseHole) => {
        // A font states a glyph's outline and its counters with opposite
        // windings, but nothing guarantees which — so both ends have to work.
        const outer = rectContour(0, 0, 100, 100);
        const hole = rectContour(30, 30, 40, 40);

        const face = faceOf([reverseOuter ? reversed(outer) : outer, reverseHole ? reversed(hole) : hole]);
        const ring = unwrapOk(factory.prism(face, up));

        expect(face.findSubShapes(ShapeTypes.wire).length).toBe(2);
        expect(ring.volume()).toBeCloseTo((rectArea(100, 100) - rectArea(40, 40)) * height, 6);
    });
});

describe("glyph contour — extruding every face at once", () => {
    test("a compound of faces extrudes into one solid per face", () => {
        const ring = faceOf([rectContour(0, 0, 100, 100), rectContour(30, 30, 40, 40)]);
        const disc = faceOf([circleContour(200, 50, 20)]);

        const container = unwrapOk(factory.combine([ring, disc]));
        const result = unwrapOk(factory.prism(container, up));

        expect(result.findSubShapes(ShapeTypes.solid).length).toBe(2);
        expect(result.volume()).toBeCloseTo(
            (rectArea(100, 100) - rectArea(40, 40)) * height +
                sampledArea(circleContour(200, 50, 20)) * height,
            0,
        );
    });
});

/** The same contour in font units, which is how the text module reads one. */
function fontContour(contour: Contour): Contour2D {
    const at = (point: XYZ) => ({ x: point.x, y: point.y });
    return {
        start: at(contour.start),
        segments: contour.segments.map((segment) =>
            segment.kind === "line"
                ? { kind: "line" as const, to: at(segment.to) }
                : { kind: "quad" as const, c1: at(segment.c1), to: at(segment.to) },
        ),
    };
}

/**
 * A font of one glyph, stated the way Noto Sans CJK states a `田`: two bars that
 * cross, so the ink is the union of two regions that overlap. A renderer resolves
 * that with a fill rule, and a solid has none.
 *
 * An em of a thousand units drawn at a size of a thousand millimetres makes a font
 * unit a millimetre, so the areas below can be read off the contours.
 */
function barsFont(contours: Contour[]): FontOutline {
    const glyphs: Record<string, GlyphOutline> = {
        X: { advance: 1000, contours: contours.map(fontContour) },
    };

    return {
        familyName: "bars",
        unitsPerEm: 1000,
        missingAdvance: 500,
        glyph: (codePoint) => glyphs[String.fromCodePoint(codePoint)],
    };
}

const crossed = () => barsFont([rectContour(100, 400, 800, 100), rectContour(450, 100, 100, 800)]);
const apart = () => barsFont([rectContour(100, 100, 200, 800), rectContour(700, 100, 200, 800)]);

const textOptions = { text: "X", size: 1000, depth: 10, plane: Plane.XY };

// The text module reaches for the application's factory, and `setCurrentApplication`
// is one-shot, so it is set once here rather than per test.
setCurrentApplication({
    shapeProvider: { factory: createTestFactory(), converter: createTestConverter() },
} as unknown as IApplication);

describe("glyph regions — merging the ones that cover each other", () => {
    test("a glyph's crossing regions extrude as one solid, counting the overlap once", () => {
        const text = unwrapOk(textShape(crossed(), textOptions));
        const solid = unwrapOk(textSolid(crossed(), textOptions));

        // The two bars are two regions of one solid, and they share a 100x100 square:
        // 800x100 plus 100x800 less the square they both cover.
        expect(text.pieces.length).toBe(1);
        expect(text.pieces[0].length).toBe(2);
        expect(solid.findSubShapes(ShapeTypes.solid).length).toBe(1);
        expect(solid.volume()).toBeCloseTo((800 * 100 + 100 * 800 - 100 * 100) * 10, 6);
    });

    test("fusing is what stops the shared square being counted twice", () => {
        const text = unwrapOk(textShape(crossed(), textOptions));

        const unfused = unwrapOk(
            factory.prism(
                unwrapOk(factory.combine(text.pieces.flat())),
                text.direction.multiply(textOptions.depth),
            ),
        );

        // Handed on as they arrive, the two bars are two bodies through each other,
        // and the square between them is in both.
        expect(unfused.findSubShapes(ShapeTypes.solid).length).toBe(2);
        expect(unfused.volume()).toBeCloseTo((800 * 100 + 100 * 800) * 10, 6);
    });

    test("regions that do not cover each other extrude as bodies of their own", () => {
        const text = unwrapOk(textShape(apart(), textOptions));
        const solid = unwrapOk(textSolid(apart(), textOptions));

        expect(text.pieces.length).toBe(2);
        expect(solid.findSubShapes(ShapeTypes.solid).length).toBe(2);
        expect(solid.volume()).toBeCloseTo((200 * 800 + 200 * 800) * 10, 6);
    });
});
