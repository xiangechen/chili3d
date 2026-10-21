// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// A text entity expands to one kernel edge per stored contour segment, and profile
// building has to hold over that expansion: a glyph's inner contour becomes a hole of
// its profile, and the text's edges mint one seed suffix each instead of sharing the
// entity's single `ent<id>` (which `uncontested` would drop wholesale). These run the
// real OCCT kernel because what is pinned is exactly the kernel-facing contract — the
// per-edge expansion, the wires/faces built from it, and the per-face attribution.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    type Contour2D,
    type FontOutline,
    type GlyphOutline,
    type IEdge,
    type IFace,
    type IVertex,
    Plane,
    ShapeTypes,
    type Vec2,
    XYZ,
} from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { sketchProfiles } from "../../src/features/profileBuilder";
import { profileEdgeSeedSuffixes } from "../../src/features/profileEntities";
import { profileEdgeSeeds } from "../../src/features/profileSeeds";
import { SketchTextCommand } from "../../src/sketch/commands/sketchText";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEntityData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { fusedTextContours, textContoursOf, textEdgeCount } from "../../src/sketch/sketchText";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

/** An axis-aligned square as one four-segment contour, the shape a text sidecar stores. */
function squareContour(x1: number, y1: number, x2: number, y2: number): Contour2D {
    return {
        start: { x: x1, y: y1 },
        segments: [
            { kind: "line", to: { x: x2, y: y1 } },
            { kind: "line", to: { x: x2, y: y2 } },
            { kind: "line", to: { x: x1, y: y2 } },
            { kind: "line", to: { x: x1, y: y1 } },
        ],
    };
}

/** A text entity whose glyphs are hand-written contours — no font is needed to build. */
function textEntity(id: number, contours: Contour2D[], angle = 0): SketchEntityData {
    return {
        id,
        type: "text",
        params: [0, 0, angle],
        text: { text: "x", size: 10, fontName: "test", fontUrl: "", contours: JSON.stringify(contours) },
    };
}

/** A SketchNode with its shape generated, as the document's evaluation would leave it. */
function sketchNodeOf(entities: SketchEntityData[]): SketchNode {
    const node = new SketchNode({
        document: createMockDocument(),
        plane: Plane.XY,
        data: { entities, constraints: [] },
    });
    const shape = node.generateShape();
    if (!shape.isOk) throw new Error(shape.error);
    node.shape = shape;
    return node;
}

function edgesOf(face: IFace): IEdge[] {
    return face.findSubShapes(ShapeTypes.edge) as IEdge[];
}

/** The one profile of `faces` with `count` boundary edges — the precondition is asserted, then used. */
function profileByEdgeCount(faces: IFace[], count: number): IFace {
    const face = faces.find((f) => edgesOf(f).length === count);
    expect(face).toBeDefined();
    return face!;
}

// An "o"-like glyph (a 10×10 outer square with a 4×4 hole at its centre) plus a second
// disjoint 4×4 glyph square — 12 contour segments on one text entity.
const O_OUTER = squareContour(0, 0, 10, 10);
const O_HOLE = squareContour(3, 3, 7, 7);
const GLYPH2 = squareContour(20, 0, 24, 4);

describe("sketch text at the kernel", () => {
    test("a text entity builds one kernel edge per contour segment", () => {
        const node = sketchNodeOf([textEntity(1, [O_OUTER, O_HOLE, GLYPH2])]);
        const shape = node.shape;
        expect(shape.isOk).toBe(true);
        // 4 + 4 segments of the "o" glyph plus 4 of the disjoint square
        expect((shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[]).length).toBe(12);
    });

    test("a glyph's inner contour becomes a hole of its outer profile", () => {
        const node = sketchNodeOf([textEntity(1, [O_OUTER, O_HOLE, GLYPH2])]);
        const profiles = sketchProfiles(node);
        expect(profiles.isOk).toBe(true);
        const { outer, inner } = profiles.unchecked()!;

        // the holed "o" profile and the disjoint glyph square are the default profiles;
        // the hole loop stays selectable as a solid profile of its own
        expect(outer.length).toBe(2);
        expect(inner.length).toBe(1);

        const oProfile = profileByEdgeCount(outer, 8);
        expect(oProfile.area()).toBeCloseTo(100 - 16, 6);

        const glyph2Profile = profileByEdgeCount(outer, 4);
        expect(glyph2Profile.area()).toBeCloseTo(16, 6);

        expect(edgesOf(inner[0]).length).toBe(4);
        expect(inner[0].area()).toBeCloseTo(16, 6);
    });

    test("a rotated text builds its edges turned, and the profile area is invariant", () => {
        // the 10×10 square turned 90° about the anchor: local +x comes out as +y, so it
        // spans u∈[−10,0], v∈[0,10] — and a rotation being rigid, the area is untouched
        const node = sketchNodeOf([textEntity(1, [O_OUTER], Math.PI / 2)]);
        const shape = node.shape;
        expect(shape.isOk).toBe(true);
        expect((shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[]).length).toBe(4);

        const { outer, inner } = sketchProfiles(node).unchecked()!;
        expect(outer.length).toBe(1);
        expect(inner.length).toBe(0);
        expect(outer[0].area()).toBeCloseTo(100, 6);

        const corners = (outer[0].findSubShapes(ShapeTypes.vertex) as IVertex[]).map((vertex) =>
            keyOf(vertex.point()),
        );
        expect(new Set(corners)).toEqual(new Set(["0,0", "0,10", "-10,10", "-10,0"]));
    });

    test("every text edge mints its own seed suffix, distinct per face", () => {
        const node = sketchNodeOf([textEntity(1, [O_OUTER, O_HOLE, GLYPH2])]);
        const { outer, inner } = sketchProfiles(node).unchecked()!;

        // k follows the contours' stored order: e0-e3 the outer square, e4-e7 the hole,
        // e8-e11 the disjoint glyph; the face's own edge enumeration order is the
        // kernel's, so the seeds are compared as sets.
        const oProfile = profileByEdgeCount(outer, 8);
        const oSeeds = profileEdgeSeeds(oProfile, "s", edgesOf(oProfile));
        expect(new Set(oSeeds)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7].map((k) => `s:ent1:e${k}`)));

        const glyph2Profile = profileByEdgeCount(outer, 4);
        const glyph2Seeds = profileEdgeSeeds(glyph2Profile, "s", edgesOf(glyph2Profile));
        expect(new Set(glyph2Seeds)).toEqual(new Set([8, 9, 10, 11].map((k) => `s:ent1:e${k}`)));

        const holeSeeds = profileEdgeSeeds(inner[0], "s", edgesOf(inner[0]));
        expect(new Set(holeSeeds)).toEqual(new Set([4, 5, 6, 7].map((k) => `s:ent1:e${k}`)));
    });

    test("a text-free face keeps plain entity seeds when a text entity shares the sketch", () => {
        const node = sketchNodeOf([
            textEntity(1, [squareContour(0, 0, 10, 10)]),
            { id: 2, type: "line", params: [20, 0, 40, 0] },
            { id: 3, type: "line", params: [40, 0, 40, 10] },
            { id: 4, type: "line", params: [40, 10, 20, 10] },
            { id: 5, type: "line", params: [20, 10, 20, 0] },
        ]);
        const { outer, inner } = sketchProfiles(node).unchecked()!;

        expect(outer.length).toBe(2);
        expect(inner.length).toBe(0);

        const withSuffixes = outer.filter((face) => profileEdgeSeedSuffixes(face) !== undefined);
        const withoutSuffixes = outer.filter((face) => profileEdgeSeedSuffixes(face) === undefined);
        expect(withSuffixes.length).toBe(1);
        expect(withoutSuffixes.length).toBe(1);

        const textSeeds = profileEdgeSeeds(withSuffixes[0], "s", edgesOf(withSuffixes[0]));
        expect(new Set(textSeeds)).toEqual(new Set([0, 1, 2, 3].map((k) => `s:ent1:e${k}`)));
        expect(withSuffixes[0].area()).toBeCloseTo(100, 6);

        // No suffix channel on the rectangle's face: its seeds are byte-identical to
        // what the pure entity-id path mints.
        const rectSeeds = profileEdgeSeeds(withoutSuffixes[0], "s", edgesOf(withoutSuffixes[0]));
        expect(new Set(rectSeeds)).toEqual(new Set([2, 3, 4, 5].map((id) => `s:ent${id}`)));
        expect(withoutSuffixes[0].area()).toBeCloseTo(200, 6);
    });

    test("geometry crossing a text seeds every region's split text pieces", () => {
        const node = sketchNodeOf([
            textEntity(1, [squareContour(0, 0, 10, 10)]),
            { id: 2, type: "line", params: [-5, 5, 15, 5] },
        ]);
        const { outer, inner } = sketchProfiles(node).unchecked()!;

        // The crossing line routes the sketch through the kernel, which returns the
        // square's lower and upper halves.
        expect(outer.length).toBe(2);
        expect(inner.length).toBe(0);
        for (const face of outer) {
            expect(face.area()).toBeCloseTo(50, 6);
            expect(profileEdgeSeedSuffixes(face)).toBeDefined();
            const seeds = profileEdgeSeeds(face, "s", edgesOf(face));
            // A region's boundary: the square's bottom/top edge, the two side pieces the
            // splitter cut, and the line's piece. Each side keeps its own text suffix —
            // the two halves of one split edge land in DIFFERENT regions, so no seed is
            // shared within a face.
            expect(seeds.length).toBe(4);
            expect(new Set(seeds).size).toBe(4);
            expect(seeds.filter((seed) => seed === "s:ent2").length).toBe(1);
            expect(seeds.filter((seed) => seed !== undefined && /^s:ent1:e[0-3]$/.test(seed)).length).toBe(3);
        }
    });

    test("an unchanged sketch's profiles are the one cached build, rebuilt on the next shape", () => {
        const node = sketchNodeOf([textEntity(1, [O_OUTER, O_HOLE, GLYPH2])]);
        // The wire count says whether the profile scan ran at all: outer, hole, and the
        // disjoint square are one wire each.
        const wire = rs.spyOn(shapeFactory, "wire");
        try {
            const first = sketchProfiles(node);
            const second = sketchProfiles(node);
            expect(second).toBe(first);
            expect(second.unchecked()!.outer[0]).toBe(first.unchecked()!.outer[0]);
            expect(wire).toHaveBeenCalledTimes(3);

            // A data edit rebuilds the shape, and the rebuild is what re-runs the scan.
            node.setDataEmitShapeChanged({
                entities: [textEntity(1, [O_OUTER, O_HOLE, squareContour(30, 0, 34, 4)])],
                constraints: [],
            });
            const rebuilt = sketchProfiles(node);
            expect(rebuilt).not.toBe(first);
            expect(rebuilt.unchecked()!.outer[0]).not.toBe(first.unchecked()!.outer[0]);
            expect(wire).toHaveBeenCalledTimes(6);
        } finally {
            wire.mockRestore();
        }
    });
});

// A placed text stores each glyph's strokes MERGED into their union (`fusedTextContours`):
// stated raw, the crossings of a glyph's strokes (a CJK 十, 国, …) would be sketch geometry
// of their own, and the even-odd profile rule would punch the overlap out as holes. The
// merge is the kernel's own fuse, read back into contours — which is what needs the kernel
// here. The one-glyph fonts run at 1000 units per em drawn at size 1000, so one font unit
// is one millimetre and the areas read straight off the contours.

/** A contour in font units, as a font states it: counter-clockwise rectangle from its lower-left corner. */
function rectGlyph(x: number, y: number, dx: number, dy: number): Contour2D {
    return {
        start: { x, y },
        segments: [
            { kind: "line", to: { x: x + dx, y } },
            { kind: "line", to: { x: x + dx, y: y + dy } },
            { kind: "line", to: { x, y: y + dy } },
            { kind: "line", to: { x, y } },
        ],
    };
}

/** A circle the way a font states one: four quadratic arcs, control points on the corners. */
function circleGlyph(cx: number, cy: number, r: number): Contour2D {
    return {
        start: { x: cx + r, y: cy },
        segments: [
            { kind: "quad", c1: { x: cx + r, y: cy + r }, to: { x: cx, y: cy + r } },
            { kind: "quad", c1: { x: cx - r, y: cy + r }, to: { x: cx - r, y: cy } },
            { kind: "quad", c1: { x: cx - r, y: cy - r }, to: { x: cx, y: cy - r } },
            { kind: "quad", c1: { x: cx + r, y: cy - r }, to: { x: cx + r, y: cy } },
        ],
    };
}

/** A one-glyph font ("X") stating the given contours as that glyph's strokes. */
function glyphFont(contours: Contour2D[]): FontOutline {
    const glyphs: Record<string, GlyphOutline> = { X: { advance: 1000, contours } };
    return {
        familyName: "glyph",
        unitsPerEm: 1000,
        missingAdvance: 500,
        glyph: (codePoint) => glyphs[String.fromCodePoint(codePoint)],
    };
}

/** Shoelace area of a line-only contour — exact, and free of the wire's traversal direction. */
function contourArea(contour: Contour2D): number {
    const points = [contour.start, ...contour.segments.map((segment) => segment.to)];
    let twice = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        twice += a.x * b.y - b.x * a.y;
    }
    return Math.abs(twice) / 2;
}

/** A point as a rounded key, so a kernel-tolerance wobble does not fail a set comparison. */
function keyOf(point: Vec2): string {
    return `${Math.round(point.x)},${Math.round(point.y)}`;
}

describe("sketch text — merging a glyph's strokes at layout", () => {
    test("crossing strokes fuse into one contour, the overlap counted once", async () => {
        const font = glyphFont([rectGlyph(100, 400, 800, 100), rectGlyph(450, 100, 100, 800)]);
        const contours = (await fusedTextContours(font, "X", 1000)).unchecked()!;

        // The plus sign: one wire of twelve straight pieces, area 800·100 + 100·800 − 100·100.
        expect(contours.length).toBe(1);
        const contour = contours[0];
        expect(contour.segments.length).toBe(12);
        expect(contour.segments.every((segment) => segment.kind === "line")).toBe(true);
        expect(contourArea(contour)).toBeCloseTo(150000, 4);
    });

    test("a straight run the fuse split mid-span comes back as one line", async () => {
        // Two overlapping rectangles whose tops are flush: the union's top side is one
        // straight run, but each stroke's corner the fuse split it at is still a vertex
        // of the wire. The readback folds such collinear splits into one line.
        const font = glyphFont([rectGlyph(100, 100, 400, 400), rectGlyph(300, 300, 400, 200)]);
        const contours = (await fusedTextContours(font, "X", 1000)).unchecked()!;

        expect(contours.length).toBe(1);
        const contour = contours[0];
        expect(contour.segments.length).toBe(6);
        expect(contour.segments.every((segment) => segment.kind === "line")).toBe(true);
        expect(contourArea(contour)).toBeCloseTo(200000, 4);
    });

    test("strokes that do not touch stay contours of their own", async () => {
        const font = glyphFont([rectGlyph(100, 100, 200, 800), rectGlyph(700, 100, 200, 800)]);
        const contours = (await fusedTextContours(font, "X", 1000)).unchecked()!;

        expect(contours.length).toBe(2);
        for (const contour of contours) {
            expect(contour.segments.length).toBe(4);
            expect(contourArea(contour)).toBeCloseTo(160000, 4);
        }

        const { outer, inner } = sketchProfiles(sketchNodeOf([textEntity(1, contours)])).unchecked()!;
        expect(outer.length).toBe(2);
        expect(inner.length).toBe(0);
        for (const face of outer) {
            expect(face.area()).toBeCloseTo(160000, 4);
        }
    });

    test("a nested stroke stays a hole of its outline, not a piece to fuse", async () => {
        const font = glyphFont([rectGlyph(100, 100, 800, 800), rectGlyph(350, 350, 200, 200)]);
        const contours = (await fusedTextContours(font, "X", 1000)).unchecked()!;

        expect(contours.length).toBe(2);
        const areas = contours.map(contourArea).sort((a, b) => a - b);
        expect(areas[0]).toBeCloseTo(40000, 4);
        expect(areas[1]).toBeCloseTo(640000, 4);

        const { outer, inner } = sketchProfiles(sketchNodeOf([textEntity(1, contours)])).unchecked()!;
        expect(outer.length).toBe(1);
        expect(outer[0].area()).toBeCloseTo(600000, 4);
        expect(inner.length).toBe(1);
        expect(inner[0].area()).toBeCloseTo(40000, 4);
    });

    test("the curves a font stated come back as curves, not a polyline", async () => {
        const glyph: Contour2D = {
            start: { x: 0, y: 0 },
            segments: [
                { kind: "line", to: { x: 400, y: 0 } },
                { kind: "quad", c1: { x: 600, y: 200 }, to: { x: 400, y: 400 } },
                { kind: "cubic", c1: { x: 200, y: 600 }, c2: { x: 0, y: 600 }, to: { x: 0, y: 400 } },
                { kind: "line", to: { x: 0, y: 0 } },
            ],
        };
        const contours = (await fusedTextContours(glyphFont([glyph]), "X", 1000)).unchecked()!;

        expect(contours.length).toBe(1);
        const contour = contours[0];
        expect(contour.segments.map((segment) => segment.kind).sort()).toEqual([
            "cubic",
            "line",
            "line",
            "quad",
        ]);

        // The wire's start and walking direction are the kernel's choice, so a curve's
        // place in the chain is not pinned — its own shape is. A reversed quad keeps its
        // control point; a reversed cubic swaps its two.
        let from = contour.start;
        for (const segment of contour.segments) {
            if (segment.kind === "quad") {
                expect(keyOf(segment.c1)).toBe("600,200");
                expect(new Set([keyOf(from), keyOf(segment.to)])).toEqual(new Set(["400,0", "400,400"]));
            } else if (segment.kind === "cubic") {
                expect(new Set([keyOf(segment.c1), keyOf(segment.c2)])).toEqual(
                    new Set(["200,600", "0,600"]),
                );
                expect(new Set([keyOf(from), keyOf(segment.to)])).toEqual(new Set(["400,400", "0,400"]));
            }
            from = segment.to;
        }
    });

    test("a fuse that cuts a curve mid-swing keeps it a curve, cut at the crossing", async () => {
        // A bar through a circle's middle: the union's rim is the bar's straight runs plus
        // the arcs of the circle outside it, each arc CUT where it meets the bar.
        const font = glyphFont([rectGlyph(0, 400, 1000, 200), circleGlyph(500, 500, 300)]);
        const contours = (await fusedTextContours(font, "X", 1000)).unchecked()!;

        expect(contours.length).toBe(1);
        let from = contours[0].start;
        let quads = 0;
        for (const segment of contours[0].segments) {
            if (segment.kind === "quad") {
                quads++;
                // one end of every arc piece is the cut — it lies on the bar's boundary
                const onCut = [from.y, segment.to.y].some(
                    (y) => Math.abs(y - 400) < 1e-4 || Math.abs(y - 600) < 1e-4,
                );
                expect(onCut).toBe(true);
            }
            from = segment.to;
        }
        expect(quads).toBeGreaterThan(0);
    });

    test("the merged contours are what the sidecar stores and the profile builds from", async () => {
        const font = glyphFont([rectGlyph(100, 400, 800, 100), rectGlyph(450, 100, 100, 800)]);
        const contours = (await fusedTextContours(font, "X", 1000)).unchecked()!;
        const entity = textEntity(1, contours);

        // stored as JSON, parsed back unchanged, and one edge per segment as ever
        expect(textContoursOf(entity)).toEqual(contours);
        expect(textEdgeCount(entity)).toBe(12);

        const { outer, inner } = sketchProfiles(sketchNodeOf([entity])).unchecked()!;
        expect(outer.length).toBe(1);
        expect(inner.length).toBe(0);
        expect(outer[0].area()).toBeCloseTo(150000, 4);
    });

    test("an empty string lays out to nothing", async () => {
        const result = await fusedTextContours(glyphFont([rectGlyph(0, 0, 100, 100)]), "", 1000);
        expect(result.isOk).toBe(false);
    });

    test("a string of glyphs the font lacks lays out to nothing", async () => {
        const result = await fusedTextContours(glyphFont([rectGlyph(0, 0, 100, 100)]), "Y", 1000);
        expect(result.isOk).toBe(false);
    });
});

// The placement command's two picks: the anchor, then the top the letters stand up to —
// the vector's direction is the text's UP (the baseline runs a quarter turn back from
// it), its length the em height. Driven the way sketchDrawCommands drives its commands
// (canned step points straight into executeMainTask), except that a text commit fuses
// the glyph's strokes (`fusedTextContours`), which is what needs the kernel here.

/**
 * A SketchTextCommand armed with the one-glyph font and canned picks, run to its commit,
 * and the stand-in editor it ran against.
 */
async function runTextCommand(points: [number, number][], size?: number) {
    const solver = new SketchSolver(Plane.XY);
    const editor = {
        node: { plane: Plane.XY },
        solver,
        solve: () => solver.solve(true),
        commit: rs.fn(() => {}),
        screenTolerance: () => 0,
    };
    const command = new SketchTextCommand();
    // canExcute's font load is stepped around: the glyph font is at hand already
    (command as any).font = glyphFont([rectGlyph(0, 0, 500, 700)]);
    command.text = "X";
    if (size !== undefined) command.size = size;
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    (command as any).stepDatas = points.map(([x, y]) => ({ point: new XYZ({ x, y, z: 0 }) }));
    try {
        await (command as any).executeMainTask();
    } finally {
        getActive.mockRestore();
    }
    return { solver, command };
}

describe("sketch text command placement", () => {
    test("the second pick sets the up direction and the em height", async () => {
        const { solver, command } = await runTextCommand([
            [0, 0],
            [6, 8],
        ]);
        try {
            const text = solver.entities().find((entity) => entity.type === "text")!;
            expect(text).toBeDefined();
            expect(text.params[0]).toBeCloseTo(0, 9);
            expect(text.params[1]).toBeCloseTo(0, 9);
            // ‖(6,8)‖ = 10 pointing at atan2(8, 6) from +u — the text's up direction,
            // so the baseline runs a quarter turn back from it
            expect(text.params[2]).toBeCloseTo(Math.atan2(8, 6) - Math.PI / 2, 9);
            expect(solver.textOf(text.id)!.size).toBeCloseTo(10, 9);
            // the 500×700-unit glyph at 10 mm em is a 5×7 rect
            const contours = textContoursOf(text);
            expect(contours.length).toBe(1);
            expect(contourArea(contours[0])).toBeCloseTo(35, 6);
            // the picked height becomes the panel's, so a repeat run starts from it
            expect(command.size).toBe(10);
        } finally {
            solver.dispose();
        }
    });

    test("a second pick on the anchor falls back to the panel size, unrotated", async () => {
        const { solver, command } = await runTextCommand(
            [
                [1, 2],
                [1, 2],
            ],
            25,
        );
        try {
            const text = solver.entities().find((entity) => entity.type === "text")!;
            expect(text).toBeDefined();
            expect(text.params).toEqual([1, 2, 0]);
            expect(solver.textOf(text.id)!.size).toBe(25);
            // the fallback did not come from a pick, so the panel's own value stands
            expect(command.size).toBe(25);
        } finally {
            solver.dispose();
        }
    });
});
