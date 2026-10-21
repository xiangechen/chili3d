// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type Contour2D, type FontOutline, type GlyphOutline, Plane, Precision } from "@chili3d/core";
import { breakEntity, breakPreview } from "../../src/sketch/breakOps";
import {
    entityParamKinds,
    PARAM_KIND_COORDINATE,
    PARAM_KIND_DIMENSIONLESS,
} from "../../src/sketch/entityLayout";
import { extendEntity } from "../../src/sketch/extendOps";
import { offsetEntities } from "../../src/sketch/offsetOps";
import {
    ConstraintKind,
    entityPointCount,
    type SketchData,
    type SketchPointRef,
    type SketchTextData,
    shapeEntityIds,
} from "../../src/sketch/sketchModel";
import {
    layoutTextContours,
    sampleTextContours,
    scaledTextContours,
    textContoursMesh,
    textContoursOf,
    textEdgeCount,
    textEntityDistance,
} from "../../src/sketch/sketchText";
import { SketchSolver } from "../../src/sketch/solver";
import {
    type SketchTransform,
    transformBase,
    transformEntities,
    transformPreview,
} from "../../src/sketch/transformOps";
import { trimEntity } from "../../src/sketch/trimOps";
import "./setup";

const TOLERANCE = 1e-6;

/** A closed 10×10 square as four line segments — the shape a laid-out sidecar stores. */
const SQUARE: Contour2D = {
    start: { x: 0, y: 0 },
    segments: [
        { kind: "line", to: { x: 10, y: 0 } },
        { kind: "line", to: { x: 10, y: 10 } },
        { kind: "line", to: { x: 0, y: 10 } },
        { kind: "line", to: { x: 0, y: 0 } },
    ],
};

/** A closed triangle beside the square: three segments, so the two together count seven. */
const TRIANGLE: Contour2D = {
    start: { x: 20, y: 0 },
    segments: [
        { kind: "line", to: { x: 24, y: 4 } },
        { kind: "line", to: { x: 28, y: 0 } },
        { kind: "line", to: { x: 20, y: 0 } },
    ],
};

function textSpec(overrides: Partial<SketchTextData> = {}): SketchTextData {
    return {
        text: "Hi",
        size: 20,
        fontName: "test",
        fontUrl: "",
        contours: JSON.stringify([SQUARE]),
        ...overrides,
    };
}

function solverWithText() {
    const solver = new SketchSolver(Plane.XY);
    const textId = solver.addText(2, 3, 0, textSpec());
    return { solver, textId };
}

describe("sketch text entity", () => {
    describe("solver channel", () => {
        test("addText contributes 3 dofs — the anchor pair plus the rotation — and exposes the anchor as its one point", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addText(3, 4, 0.25, textSpec());
                expect(solver.dofs()).toBe(3);
                // anchor coordinates, then a dimensionless scalar — a circle's radius the
                // same way: a value, not a drag point
                expect(entityParamKinds("text")).toEqual([
                    PARAM_KIND_COORDINATE,
                    PARAM_KIND_COORDINATE,
                    PARAM_KIND_DIMENSIONLESS,
                ]);

                const entity = solver.entity(id)!;
                expect(entity.type).toBe("text");
                expect(entity.params).toEqual([3, 4, 0.25]);
                expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([3, 4]);
                expect(solver.entityPoints(id)).toEqual([[3, 4]]);
                expect(solver.textOf(id)).toEqual(textSpec());
            } finally {
                solver.dispose();
            }
        });

        test("toData round-trips byte-identical, sidecar included", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                solver.addLine(0, 0, 10, 0);
                const spec = textSpec({ contours: JSON.stringify([SQUARE, TRIANGLE]) });
                const textId = solver.addText(5, 6, 0.4, spec);
                solver.solve(true);

                const data = solver.toData();
                const restored = new SketchSolver(Plane.XY, data);
                try {
                    expect(JSON.stringify(restored.toData())).toBe(JSON.stringify(data));
                    // every sidecar field survives the reload, and the rotation rides the params
                    expect(restored.entity(textId)!.text).toEqual(spec);
                    expect(restored.entity(textId)!.params).toEqual([5, 6, 0.4]);
                    expect(restored.textOf(textId)).toEqual(spec);
                } finally {
                    restored.dispose();
                }
            } finally {
                solver.dispose();
            }
        });

        test("a text-free sketch serializes without a text key, before and after a reload", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                solver.addLine(0, 0, 10, 0);
                solver.addCircle(5, 5, 3);
                solver.solve(true);

                const data = solver.toData();
                expect(JSON.stringify(data)).not.toContain('"text"');
                for (const entity of data.entities) {
                    expect("text" in entity).toBe(false);
                }

                const restored = new SketchSolver(Plane.XY, data);
                try {
                    expect(JSON.stringify(restored.toData())).not.toContain('"text"');
                } finally {
                    restored.dispose();
                }
            } finally {
                solver.dispose();
            }
        });

        test("setText with an unchanged spec writes nothing", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addText(3, 4, 0, textSpec());
                const before = JSON.stringify(solver.toData());
                expect(solver.setText(id, textSpec())).toBe(false);
                // an edit confirmed untouched must not record a phantom history entry
                expect(JSON.stringify(solver.toData())).toBe(before);
            } finally {
                solver.dispose();
            }
        });

        test.each([
            0,
            -5,
            Number.NaN,
        ])("a stored sidecar with size %s is repaired on load: the text drops, the anchor stays", (size) => {
            // the edit path takes the size as a DIVISOR when rescaling the contours —
            // a zero here would turn a height edit into a wiped sidecar
            const data: SketchData = {
                entities: [{ id: 1, type: "text", params: [3, 4, 0], text: textSpec({ size }) }],
                constraints: [],
            };
            const solver = new SketchSolver(Plane.XY, data);
            try {
                expect(solver.textOf(1)).toBeUndefined();
                expect(solver.entity(1)!.params).toEqual([3, 4, 0]);
                const persisted = solver.toData().entities.find((entity) => entity.id === 1)!;
                expect("text" in persisted).toBe(false);
            } finally {
                solver.dispose();
            }
        });

        test("setText with a changed spec replaces the sidecar and the change serializes", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addText(3, 4, 0, textSpec());
                const updated = textSpec({ size: 40, contours: JSON.stringify([TRIANGLE]) });
                expect(solver.setText(id, updated)).toBe(true);

                const stored = solver.textOf(id)!;
                expect(stored.size).toBe(40);
                expect(stored.contours).toBe(updated.contours);

                const serialized = solver.toData().entities.find((entity) => entity.id === id)!;
                expect(serialized.text).toEqual(updated);
            } finally {
                solver.dispose();
            }
        });

        test("setText refuses a non-text entity", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                expect(solver.setText(lineId, textSpec())).toBe(false);
                expect(solver.entity(lineId)!.text).toBeUndefined();
            } finally {
                solver.dispose();
            }
        });

        test("a stored text with no rotation param loads as unrotated (θ = 0 appended)", () => {
            // documents from before the rotation param carry [x, y] — normalization pads them
            const data: SketchData = {
                entities: [{ id: 7, type: "text", params: [5, 6], text: textSpec() }],
                constraints: [],
            };
            const solver = new SketchSolver(Plane.XY, data);
            try {
                expect(solver.entity(7)!.params).toEqual([5, 6, 0]);
                expect(solver.textOf(7)).toEqual(textSpec());
            } finally {
                solver.dispose();
            }
        });

        test("setTextAngle turns the text and leaves the stored contours alone", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addText(3, 4, 0, textSpec());
                const before = solver.textOf(id)!;

                expect(solver.setTextAngle(id, Math.PI / 2)).toBe(true);
                expect(solver.entity(id)!.params).toEqual([3, 4, Math.PI / 2]);
                // no re-layout: the contours are local-frame, a turn only re-reads them
                expect(solver.textOf(id)).toEqual(before);
                // and the write serializes
                expect(solver.toData().entities.find((entity) => entity.id === id)!.params[2]).toBe(
                    Math.PI / 2,
                );
            } finally {
                solver.dispose();
            }
        });

        test("setTextAngle writes nothing when the angle did not change beyond the angle tolerance", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addText(3, 4, 0, textSpec());
                const before = JSON.stringify(solver.toData());
                // an edit confirmed untouched, or nudged past the angle tolerance, is no write
                expect(solver.setTextAngle(id, 0)).toBe(false);
                expect(solver.setTextAngle(id, Precision.Angle / 2)).toBe(false);
                expect(JSON.stringify(solver.toData())).toBe(before);
            } finally {
                solver.dispose();
            }
        });

        test("setTextAngle refuses a non-text entity", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                expect(solver.setTextAngle(lineId, 1)).toBe(false);
                expect(solver.entity(lineId)!.params).toEqual([0, 0, 10, 0]);
            } finally {
                solver.dispose();
            }
        });

        test("textOf hands out a copy — editing it changes nothing stored", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addText(3, 4, 0, textSpec());
                const handed = solver.textOf(id)!;
                handed.size = 999;
                handed.contours = "corrupted";
                expect(solver.textOf(id)).toEqual(textSpec());
            } finally {
                solver.dispose();
            }
        });

        test("removeEntity drops the sidecar with the entity", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addText(3, 4, 0, textSpec());
                solver.removeEntity(id);
                expect(solver.textOf(id)).toBeUndefined();
                expect(JSON.stringify(solver.toData())).not.toContain('"text"');
            } finally {
                solver.dispose();
            }
        });
    });

    describe("the anchor is a constraint target", () => {
        test("a text entity exposes exactly one point — its anchor", () => {
            // the rotation is a scalar param, like a circle's radius: no drag point of its own
            expect(entityPointCount({ type: "text", params: [3, 4, 0] })).toBe(1);
            expect(entityPointCount({ type: "line", params: [0, 0, 1, 1] })).toBe(2);
        });

        test("a coincident constraint between a text anchor and a line endpoint solves", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                const textId = solver.addText(10.3, 0.2, 0, textSpec());
                solver.addConstraint({
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: textId, pointIndex: 0 },
                        { entityId: lineId, pointIndex: 1 },
                    ],
                });

                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const anchor = solver.pointOf({ entityId: textId, pointIndex: 0 });
                const end = solver.pointOf({ entityId: lineId, pointIndex: 1 });
                expect(anchor[0]).toBeCloseTo(end[0], 6);
                expect(anchor[1]).toBeCloseTo(end[1], 6);
            } finally {
                solver.dispose();
            }
        });

        test("a Fix datum pins the anchor, and the glyphs follow it", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const textId = solver.addText(3, 4, 0, textSpec());
                solver.addConstraint({
                    kind: ConstraintKind.Fix,
                    refs: [{ entityId: textId, pointIndex: 0 }],
                    datums: [8, 9],
                });
                // the pin holds the anchor's two coordinates; the rotation stays free,
                // the way a pinned circle keeps its radius
                expect(solver.dofs()).toBe(1);

                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const anchor = solver.pointOf({ entityId: textId, pointIndex: 0 });
                expect(anchor[0]).toBeCloseTo(8, 6);
                expect(anchor[1]).toBeCloseTo(9, 6);
            } finally {
                solver.dispose();
            }
        });

        test("dragging the anchor moves the text", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const textId = solver.addText(3, 4, 0, textSpec());
                const ref: SketchPointRef = { entityId: textId, pointIndex: 0 };
                solver.beginDrag([ref]);
                solver.dragTo(ref, 15, 8);
                solver.endDrag();
                const anchor = solver.pointOf(ref);
                expect(anchor[0]).toBeCloseTo(15, 6);
                expect(anchor[1]).toBeCloseTo(8, 6);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("sketchText helpers", () => {
        test("textContoursOf parses the stored contours, memoized by the contours string", () => {
            const spec = textSpec({ contours: JSON.stringify([SQUARE, TRIANGLE]) });
            const first = textContoursOf({ text: spec });
            expect(first).toEqual([SQUARE, TRIANGLE]);
            // a second entity carrying the same string reads the one parsed array
            expect(textContoursOf({ text: { ...spec } })).toBe(first);
        });

        test("a missing or unreadable sidecar reads as no contours", () => {
            expect(textContoursOf({})).toEqual([]);
            expect(textContoursOf({ text: textSpec({ contours: "not json" }) })).toEqual([]);
            expect(textContoursOf({ text: textSpec({ contours: "[1, 2]" }) })).toEqual([]);
            // well-formed JSON but not well-formed contours
            expect(
                textContoursOf({ text: textSpec({ contours: '[{"start":{"x":0},"segments":[]}]' }) }),
            ).toEqual([]);
        });

        test("textEdgeCount sums the segments of every contour", () => {
            const both = textSpec({ contours: JSON.stringify([SQUARE, TRIANGLE]) });
            expect(textEdgeCount({ text: both })).toBe(7);
            expect(textEdgeCount({ text: textSpec() })).toBe(4);
            expect(textEdgeCount({})).toBe(0);
            expect(textEdgeCount({ text: textSpec({ contours: "garbage" }) })).toBe(0);
        });

        test("sampleTextContours flattens the contours and shifts them by the anchor", () => {
            const entity = { params: [100, 50], text: textSpec({ contours: JSON.stringify([TRIANGLE]) }) };
            expect(sampleTextContours(entity)).toEqual([
                [
                    [120, 50],
                    [124, 54],
                    [128, 50],
                    [120, 50],
                ],
            ]);
        });

        test("sampleTextContours turns the contours by the entity's angle about the anchor", () => {
            // 90° counter-clockwise: local +u comes out as +v, local +v as −u, so the
            // triangle at local (20..28, 0..4) lands at (96..100, 70..78) off the anchor
            const entity = {
                params: [100, 50, Math.PI / 2],
                text: textSpec({ contours: JSON.stringify([TRIANGLE]) }),
            };
            const sampled = sampleTextContours(entity);
            expect(sampled).toHaveLength(1);
            const expected = [
                [100, 70],
                [96, 74],
                [100, 78],
                [100, 70],
            ];
            expect(sampled[0]).toHaveLength(expected.length);
            sampled[0].forEach(([u, v], index) => {
                expect(u).toBeCloseTo(expected[index][0], 9);
                expect(v).toBeCloseTo(expected[index][1], 9);
            });
        });

        test("textEntityDistance measures to the nearest contour segment", () => {
            const entity = { params: [0, 0], text: textSpec() };
            // 3 below the square's bottom edge
            expect(textEntityDistance([5, -3], entity)).toBeCloseTo(3, 9);
            // the square's centre sits 5 from every edge
            expect(textEntityDistance([5, 5], entity)).toBeCloseTo(5, 9);
            // far away in empty space, the corner (10, 10) is the nearest point
            expect(textEntityDistance([50, 50], entity)).toBeCloseTo(Math.hypot(40, 40), 9);
            // a text with nothing stored is nowhere — a hit test never lands on it
            expect(textEntityDistance([0, 0], { params: [0, 0] })).toBe(Infinity);
        });

        test("textEntityDistance measures against the rotated outline", () => {
            // turned 90° about the anchor, the 10×10 square stands at u∈[−10,0], v∈[0,10]
            const entity = { params: [0, 0, Math.PI / 2], text: textSpec() };
            // (5, 5) is 5 right of the square's near edge — unrotated it was inside it
            expect(textEntityDistance([5, 5], entity)).toBeCloseTo(5, 9);
            // the rotated square's centre sits 5 from every edge
            expect(textEntityDistance([-5, 5], entity)).toBeCloseTo(5, 9);
        });

        test("textContoursMesh lays the polylines out as consecutive segment pairs", () => {
            const open: Contour2D = {
                start: { x: 1, y: 2 },
                segments: [
                    { kind: "line", to: { x: 3, y: 4 } },
                    { kind: "line", to: { x: 5, y: 2 } },
                ],
            };
            const mesh = textContoursMesh(
                Plane.XY,
                { params: [10, 20], text: textSpec({ contours: JSON.stringify([open]) }) },
                7,
            );
            expect(mesh.color).toBe(7);
            expect(mesh.lineType).toBe("solid");
            // two segments = two (p0, p1) pairs, world coordinates on the XY plane
            expect([...mesh.position]).toEqual([11, 22, 0, 13, 24, 0, 13, 24, 0, 15, 22, 0]);
        });
    });

    describe("layoutTextContours", () => {
        /**
         * A hand-built font: unitsPerEm 1000, 'a' a 500-unit square with one quad side and
         * advance 600, 'b' a 0.05-unit speck too small to keep at any size, and no glyph
         * for anything else (missingAdvance 500).
         */
        function mockFont(): FontOutline {
            const glyphs = new Map<number, GlyphOutline>([
                [
                    97, // 'a'
                    {
                        advance: 600,
                        contours: [
                            {
                                start: { x: 0, y: 0 },
                                segments: [
                                    { kind: "line", to: { x: 500, y: 0 } },
                                    { kind: "quad", c1: { x: 750, y: 250 }, to: { x: 500, y: 500 } },
                                    { kind: "line", to: { x: 0, y: 500 } },
                                ],
                            },
                        ],
                    },
                ],
                [
                    98, // 'b'
                    {
                        advance: 600,
                        contours: [
                            {
                                start: { x: 0, y: 0 },
                                segments: [
                                    { kind: "line", to: { x: 0.05, y: 0 } },
                                    { kind: "line", to: { x: 0.05, y: 0.05 } },
                                    { kind: "line", to: { x: 0, y: 0.05 } },
                                ],
                            },
                        ],
                    },
                ],
            ]);
            return {
                familyName: "mock",
                unitsPerEm: 1000,
                missingAdvance: 500,
                glyph: (codePoint) => glyphs.get(codePoint),
            };
        }

        test("glyphs scale from font units to millimetres by size/unitsPerEm", () => {
            const contours = layoutTextContours(mockFont(), "a", 20);
            // scale = 20 / 1000 = 0.02: the 500-unit square comes out 10 mm
            expect(contours).toEqual([
                {
                    start: { x: 0, y: 0 },
                    segments: [
                        { kind: "line", to: { x: 10, y: 0 } },
                        { kind: "quad", c1: { x: 15, y: 5 }, to: { x: 10, y: 10 } },
                        { kind: "line", to: { x: 0, y: 10 } },
                    ],
                },
            ]);
        });

        test("the second character is shifted by the first glyph's pen advance", () => {
            const contours = layoutTextContours(mockFont(), "aa", 20);
            expect(contours).toHaveLength(2);
            // advance 600 font units = 12 mm at this size
            expect(contours[1].start).toEqual({ x: 12, y: 0 });
            expect(contours[1].segments[0]).toEqual({ kind: "line", to: { x: 22, y: 0 } });
        });

        test("a character the font has no glyph for is skipped but keeps its advance", () => {
            const contours = layoutTextContours(mockFont(), "a文a", 20);
            expect(contours).toHaveLength(2);
            // the missing character advances the pen by missingAdvance 500 = 10 mm,
            // so the last 'a' starts at (600 + 500) × 0.02 = 22
            expect(contours[1].start).toEqual({ x: 22, y: 0 });
        });

        test("a contour too small to draw is dropped; the glyph's neighbours are not", () => {
            // minContourSize = size × 1e-4 = 0.002 mm; the 0.05-unit speck is 0.001 mm wide
            expect(layoutTextContours(mockFont(), "b", 20)).toEqual([]);
            const contours = layoutTextContours(mockFont(), "ab", 20);
            expect(contours).toHaveLength(1);
            expect(contours[0].start).toEqual({ x: 0, y: 0 });
        });
    });

    describe("scaledTextContours", () => {
        test("every segment kind's points multiply by the factor", () => {
            const contour: Contour2D = {
                start: { x: 1, y: 2 },
                segments: [
                    { kind: "line", to: { x: 3, y: 4 } },
                    { kind: "quad", c1: { x: 5, y: 6 }, to: { x: 7, y: 8 } },
                    { kind: "cubic", c1: { x: 9, y: 10 }, c2: { x: 11, y: 12 }, to: { x: 13, y: 14 } },
                ],
            };
            expect(scaledTextContours([contour], 2.5)).toEqual([
                {
                    start: { x: 2.5, y: 5 },
                    segments: [
                        { kind: "line", to: { x: 7.5, y: 10 } },
                        { kind: "quad", c1: { x: 12.5, y: 15 }, to: { x: 17.5, y: 20 } },
                        {
                            kind: "cubic",
                            c1: { x: 22.5, y: 25 },
                            c2: { x: 27.5, y: 30 },
                            to: { x: 32.5, y: 35 },
                        },
                    ],
                },
            ]);
        });

        test("scaling a layout by two IS the layout at twice the size", () => {
            // unitsPerEm 1024: the scale is a power of two, so the comparison is exact
            // rather than to-a-tolerance — this is the linearity the edit path leans on
            const font: FontOutline = {
                familyName: "exact",
                unitsPerEm: 1024,
                missingAdvance: 512,
                glyph: () => ({
                    advance: 768,
                    contours: [
                        {
                            start: { x: 0, y: 0 },
                            segments: [
                                { kind: "line", to: { x: 512, y: 0 } },
                                { kind: "quad", c1: { x: 768, y: 256 }, to: { x: 512, y: 512 } },
                                { kind: "line", to: { x: 0, y: 512 } },
                            ],
                        },
                    ],
                }),
            };
            expect(scaledTextContours(layoutTextContours(font, "aa", 32), 2)).toEqual(
                layoutTextContours(font, "aa", 64),
            );
        });
    });

    describe("shapeEntityIds", () => {
        test("a text entity lists its id once per stored edge, in profile-entity order", () => {
            const data: SketchData = {
                entities: [
                    { id: 1, type: "line", params: [0, 0, 10, 0] },
                    {
                        id: 2,
                        type: "text",
                        params: [0, 0, 0],
                        text: textSpec({ contours: JSON.stringify([SQUARE, TRIANGLE]) }),
                    },
                    // no curve, no profile: neither of these two lists an id
                    { id: 3, type: "point", params: [1, 1] },
                    { id: 4, type: "text", params: [5, 5, 0], text: textSpec(), construction: true },
                    { id: 5, type: "circle", params: [20, 20, 5] },
                ],
                constraints: [],
            };
            // 4 segments of the square + 3 of the triangle, between the line and the circle
            expect(shapeEntityIds(data)).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 5]);
        });

        test("a text entity whose sidecar cannot be read lists no id", () => {
            const data: SketchData = {
                entities: [
                    { id: 1, type: "text", params: [0, 0, 0], text: textSpec({ contours: "garbage" }) },
                    { id: 2, type: "line", params: [0, 0, 10, 0] },
                ],
                constraints: [],
            };
            expect(shapeEntityIds(data)).toEqual([2]);
        });
    });

    describe("the curve ops refuse a text", () => {
        test("offset: a text alone is nothing to offset, beside a line it is ignored", () => {
            const { solver, textId } = solverWithText();
            try {
                const alone = offsetEntities(solver, [textId], 1, TOLERANCE);
                expect(alone.isOk).toBe(false);
                expect(alone.error).toBe("Nothing to offset");

                const lineId = solver.addLine(0, 0, 10, 0);
                const mixed = offsetEntities(solver, [lineId, textId], 1, TOLERANCE);
                expect(mixed.isOk).toBe(true);
                expect(mixed.value.createdEntityIds).toHaveLength(1);
                expect(solver.entity(mixed.value.createdEntityIds[0])!.type).toBe("line");
            } finally {
                solver.dispose();
            }
        });

        test("trim refuses a text", () => {
            const { solver, textId } = solverWithText();
            try {
                const result = trimEntity(solver, textId, [2, 3], TOLERANCE);
                expect(result.isOk).toBe(false);
                expect(result.error).toBe("A text cannot be trimmed");
            } finally {
                solver.dispose();
            }
        });

        test("break refuses a text and previews nothing for it", () => {
            const { solver, textId } = solverWithText();
            try {
                const result = breakEntity(solver, textId, [[2, 3]], TOLERANCE);
                expect(result.isOk).toBe(false);
                expect(result.error).toBe("A text cannot be broken");
                expect(breakPreview(solver, textId, [[2, 3]], TOLERANCE)).toEqual([]);
            } finally {
                solver.dispose();
            }
        });

        test("extend refuses a text as target and as boundary", () => {
            const { solver, textId } = solverWithText();
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                const asTarget = extendEntity(solver, {
                    targetId: textId,
                    targetUv: [2, 3],
                    boundaryId: lineId,
                    boundaryUv: [10, 0],
                    modifyBoundary: false,
                    tolerance: TOLERANCE,
                });
                expect(asTarget.isOk).toBe(false);
                expect(asTarget.error).toBe("A text has no end to extend");

                const asBoundary = extendEntity(solver, {
                    targetId: lineId,
                    targetUv: [10, 0],
                    boundaryId: textId,
                    boundaryUv: [2, 3],
                    modifyBoundary: false,
                    tolerance: TOLERANCE,
                });
                expect(asBoundary.isOk).toBe(false);
                expect(asBoundary.error).toBe("A text is no boundary to extend to");
            } finally {
                solver.dispose();
            }
        });

        test("the transform moves nothing of a text: no base, no preview, no move", () => {
            const { solver, textId } = solverWithText();
            try {
                const shift: SketchTransform = { du: 5, dv: 0, angle: 0, scale: 1 };
                expect(transformBase(solver, [textId])).toBeUndefined();
                expect(transformPreview(solver, [textId], [0, 0], shift)).toEqual([]);
                const moved = transformEntities(solver, [textId], [0, 0], shift);
                expect(moved.isOk).toBe(false);
                expect(moved.error).toBe("Nothing to transform");
                expect(solver.pointOf({ entityId: textId, pointIndex: 0 })).toEqual([2, 3]);
            } finally {
                solver.dispose();
            }
        });

        test("a transform of a mixed selection moves the geometry and leaves the text", () => {
            const { solver, textId } = solverWithText();
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                const base = transformBase(solver, [lineId, textId])!;
                // the text is out of the bound: the base is the line's own centre
                expect(base).toEqual([5, 0]);
                const moved = transformEntities(solver, [lineId, textId], base, {
                    du: 5,
                    dv: 2,
                    angle: 0,
                    scale: 1,
                });
                expect(moved.isOk).toBe(true);
                expect(moved.value.movedEntityIds).toEqual([lineId]);
                expect(solver.pointOf({ entityId: lineId, pointIndex: 0 })).toEqual([5, 2]);
                expect(solver.pointOf({ entityId: textId, pointIndex: 0 })).toEqual([2, 3]);
            } finally {
                solver.dispose();
            }
        });

        test("an array never generates an instance off a text source", () => {
            const { solver, textId } = solverWithText();
            try {
                const added = solver.addArray(
                    { type: "linear", x: { count: 2, spacing: 10 }, y: { count: 1, spacing: 0 } },
                    [textId],
                );
                expect(added.isOk).toBe(true);
                // the pick filter keeps text out of the tool; the op's own skip is what
                // keeps a record that names one anyway from laying down instances
                expect(solver.entities().map((entity) => entity.id)).toEqual([textId]);
                expect(solver.arrayRecord(added.value)!.instanceEntityIds).toEqual([]);
            } finally {
                solver.dispose();
            }
        });
    });
});
