// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type FaceMeshData,
    type ICameraController,
    Plane,
    Result,
    type ShapeMeshData,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
// side effect: registers the constraint commands so their decorator icons resolve
import "../../src/sketch/commands/sketchConstraints";
import { SKETCH_TEXT_HEIGHT_PX } from "../../src/sketch/editor/dimensionLayout";
import { clusterBadges, SketchAnnotationManager } from "../../src/sketch/editor/sketchAnnotations";
import style from "../../src/sketch/editor/sketchAnnotations.module.css";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { SketchSolver } from "../../src/sketch/solver";
import { laidTexts } from "./laidTexts";
import "./setup";

function setup() {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: 0, z: 500 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitY,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;

    const badgeDisposes: ReturnType<typeof rs.fn>[] = [];
    const htmlTexts: string[] = [];
    (view as any).htmlText = rs.fn((text: string) => {
        htmlTexts.push(text);
        const dispose = rs.fn();
        badgeDisposes.push(dispose);
        return { dispose };
    });

    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
            line: () => Result.ok({ isEqual: () => false }),
            circle: () => Result.ok({ isEqual: () => false }),
            wire: () => Result.ok({ isEqual: () => false }),
            combine: () => Result.ok({ isEqual: () => false }),
        },
        writable: true,
        configurable: true,
    });
    const restoreFactory = () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
    return { doc, view, htmlTexts, badgeDisposes, restoreFactory };
}

function pointerEvent(x: number, y: number, button = 0): PointerEvent {
    return { offsetX: x, offsetY: y, button } as PointerEvent;
}

describe("SketchAnnotations visibility", () => {
    test("constraint badges are hidden until a referenced entity is highlighted", () => {
        const { doc, view, htmlTexts, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solve(true);
            expect(htmlTexts).not.toContain("H");

            // hover the line: the H badge appears
            (doc.visual.eventHandler as SketchEventHandler).pointerMove(view, pointerEvent(405, 300));
            expect(htmlTexts).toContain("H");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("an inert constraint badge is drawn as usual, minus the pointer events", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            // this harness needs the elements, not just the texts
            const created: { text: string; element: HTMLElement }[] = [];
            (view as any).htmlText = (text: string, _position: unknown, options: any) => {
                const element = document.createElement("div");
                // the real helper puts the requested classes on before handing it over
                if (options?.className !== undefined) element.className = options.className;
                created.push({ text, element });
                options?.onCreated?.(element);
                return { dispose: () => {} };
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const circle = editor.solver.addCircle(300, 0, 5);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
            });
            const radius = editor.solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [{ entityId: circle, pointIndex: 0 }],
                datum: 5,
            });
            // the label is what the pointer hits where it reads, so keep it off the line the
            // hover below is about
            editor.dimensionAnchors.set(radius, { kind: "vector", dx: 0, dy: 40 });
            editor.solve(true);
            (doc.visual.eventHandler as SketchEventHandler).pointerMove(view, pointerEvent(405, 300));

            const before = created.find((entry) => entry.text === "H");
            if (before === undefined) throw new Error("the H badge was not created");
            expect(before.element.classList.contains(style.inert)).toBe(false);

            const countBeforeFlip = created.length;
            editor.annotations.inertConstraintSymbols = true;

            // the flip is a restyle, not a redraw: a badge that is still wanted keeps its
            // element (`drawBadge`), which is what lets a press survive the repaint
            expect(created.length).toBe(countBeforeFlip);
            // the symbol is drawn exactly as before, only transparent to the pointer
            expect(before.element.classList.contains(style.inert)).toBe(true);
            // and a datum has no badge of its own to make inert: its value is drawn as mesh
            // glyphs, and the pointer reaches it through the plane hit-test instead
            expect(created.filter((entry) => entry.text !== "H")).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("constraint badges disappear when the highlight moves away", () => {
        const { doc, view, htmlTexts, badgeDisposes, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerMove(view, pointerEvent(405, 300));
            expect(htmlTexts).toContain("H");

            handler.pointerMove(view, pointerEvent(100, 100));
            expect(badgeDisposes.every((d) => d.mock.calls.length > 0)).toBe(true);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("datum dimensions stay visible without any highlight", () => {
        const { doc, htmlTexts, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            editor.solve(true);
            expect(laidTexts(() => editor.solve(true))).toContain("10.00");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a radius dimension reads with its prefix, like every other dimension", () => {
        const { doc, htmlTexts, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addCircle(0, 0, 30);
            editor.solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [{ entityId: 1, pointIndex: 0 }],
                datum: 30,
            });
            editor.solve(true);

            // the `R` is the dimension's own affix (see `dimensionText`), not the caller's
            expect(laidTexts(() => editor.solve(true))).toContain("R30.00");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("an angle dimension reads the supplement its stored refs carry", () => {
        const { doc, htmlTexts, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 0, 50, 50);
            // the second line's refs run backwards — the 135° sector — with the label
            // anchored in it, at world (0, 50)
            const id = editor.solver.addConstraint({
                kind: ConstraintKind.Angle,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                    { entityId: 2, pointIndex: 1 },
                    { entityId: 2, pointIndex: 0 },
                ],
                datum: (-3 * Math.PI) / 4,
            });
            editor.dimensionAnchors.set(id, { kind: "vector", dx: 0, dy: 50 });
            editor.solve(true);
            expect(laidTexts(() => editor.solve(true))).toContain("135.0°");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("constraint badges stay visible while dragging a referenced point", () => {
        const { doc, view, htmlTexts, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solve(true);
            expect(htmlTexts).not.toContain("H");

            const handler = doc.visual.eventHandler as SketchEventHandler;
            // mock view: worldToScreen maps (0,0,0) -> (400, 300), grab the line start point
            handler.pointerDown(view, pointerEvent(400, 300));
            expect(htmlTexts).toContain("H");
            handler.pointerUp(view, pointerEvent(400, 300));
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a multi-entity constraint shows one badge next to each entity", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const badges: { text: string; u: number; v: number }[] = [];
            (view as any).htmlText = rs.fn((text: string, point: XYZ) => {
                badges.push({ text, u: point.x, v: point.y });
                return { dispose: rs.fn() };
            });
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            const l1 = editor.solver.addLine(0, 0, 10, 0);
            const l2 = editor.solver.addLine(0, 50, 10, 50);
            editor.solver.addConstraint({
                kind: ConstraintKind.Parallel,
                refs: [
                    { entityId: l1, pointIndex: 0 },
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                    { entityId: l2, pointIndex: 1 },
                ],
            });
            editor.solve(true);
            expect(badges.filter((b) => b.text === "∥").length).toBe(0);

            // hover line 1: one badge per line, not a single one midway in empty space
            (doc.visual.eventHandler as SketchEventHandler).pointerMove(view, pointerEvent(405, 300));
            const shown = badges.filter((b) => b.text === "∥");
            expect(shown.length).toBe(2);
            // px = 1 in the mock view, so the badge offset is 18 world units
            const vs = shown.map((b) => b.v).sort((a, b) => a - b);
            expect(vs[0]).toBeCloseTo(18, 5);
            expect(vs[1]).toBeCloseTo(68, 5);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("symbol badges render the icon from the command decorator", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const elements: HTMLElement[] = [];
            (view as any).htmlText = rs.fn((_text: string, _point: XYZ, options?: any) => {
                const element = document.createElement("div");
                options?.onCreated?.(element);
                elements.push(element);
                return { dispose: rs.fn() };
            });
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solve(true);

            (doc.visual.eventHandler as SketchEventHandler).pointerMove(view, pointerEvent(405, 300));
            const iconHrefs = elements.map((el) => el.querySelector("use")?.getAttribute("href"));
            expect(iconHrefs).toContain("#icon-cHorizontal");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});

describe("SketchAnnotationManager mesh text", () => {
    // the test font in ./setup draws one triangle per character, so mesh sizes stay countable

    function captureMesh(doc: TestDocument) {
        const calls: ShapeMeshData[][] = [];
        (doc.visual.context as any).displayMesh = rs.fn((meshes: ShapeMeshData[]) => {
            calls.push(meshes);
            return 1;
        });
        return calls;
    }

    function faceMeshOf(calls: ShapeMeshData[][]): FaceMeshData | undefined {
        const last = calls[calls.length - 1] ?? [];
        return last.find((mesh): mesh is FaceMeshData => "index" in mesh);
    }

    test("datum text draws as mesh glyphs parallel to the dimension line", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const calls = captureMesh(doc);

            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            editor.solve(true);

            // face mesh = 2 arrowheads (6 corners) + the text "10.00"
            // (5 glyphs × 1 triangle of the test font)
            const face = faceMeshOf(calls);
            expect(face).toBeDefined();
            expect(face?.position.length).toBe((6 + 15) * 3);

            // px = 1 in the mock view: the clamped offset puts the dimension line at
            // y = 14, the anchor half a text height above it; the first glyph corner
            // (-2.5, -0.5) ems lands at (5 - 2.5·em, 14) — the em lift cancels out
            const em = SKETCH_TEXT_HEIGHT_PX;
            const position = Array.from(face?.position ?? []);
            const hit = position.some(
                (_, i) =>
                    i % 3 === 0 &&
                    Math.abs(position[i] - (5 - 2.5 * em)) < 1e-6 &&
                    Math.abs(position[i + 1] - 14) < 1e-6 &&
                    Math.abs(position[i + 2]) < 1e-6,
            );
            expect(hit).toBe(true);

            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("an along anchor draws the label where the user put it on the dimension line", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const calls = captureMesh(doc);
            (view as any).htmlText = rs.fn(() => ({ dispose: rs.fn() }));

            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            const id = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            // a quarter of the way along, 14 above the segment
            editor.dimensionAnchors.set(id, { kind: "offset", offset: 14, along: 2.5 });
            editor.solve(true);

            // px = 1, so the first glyph corner (-2.5, -0.5) ems sits on the dimension
            // line at x = 2.5 instead of the segment's middle
            const em = SKETCH_TEXT_HEIGHT_PX;
            const position = Array.from(faceMeshOf(calls)?.position ?? []);
            const hit = position.some(
                (_, i) =>
                    i % 3 === 0 &&
                    Math.abs(position[i] - (2.5 - 2.5 * em)) < 1e-6 &&
                    Math.abs(position[i + 1] - 14) < 1e-6,
            );
            expect(hit).toBe(true);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a broken expression keeps the visible error badge and draws no text", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const calls = captureMesh(doc);
            const elements: { text: string; element: HTMLElement; className?: string }[] = [];
            (view as any).htmlText = rs.fn((text: string, _point: XYZ, options?: any) => {
                const element = document.createElement("div");
                options?.onCreated?.(element);
                elements.push({ text, element, className: options?.className });
                return { dispose: rs.fn() };
            });

            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: "nope*2",
            });
            editor.solve(true);

            // arrows only — no text triangles for a broken expression
            const face = faceMeshOf(calls);
            expect(face?.position.length).toBe(6 * 3);

            // the badge stays visible and carries the error styling
            const badge = elements.find((b) => b.text === "nope*2");
            expect(badge?.className).not.toContain(style.ghost);
            expect(badge?.element.classList.contains(style.error)).toBe(true);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});

describe("SketchAnnotationManager arc badge anchors", () => {
    test("an arc with a sweep over 180° anchors its badge on the true mid-sweep side", () => {
        const { view, restoreFactory } = setup();
        try {
            const badges: { text: string; x: number; y: number }[] = [];
            (view as any).htmlText = rs.fn((text: string, point: XYZ) => {
                badges.push({ text, x: point.x, y: point.y });
                return { dispose: rs.fn() };
            });
            const solver = new SketchSolver(Plane.XY);
            // 270° sweep from (10, 0) to (0, -10): the chord-midpoint direction
            // (√2/2, −√2/2) is the antipode of the true mid-sweep (−√2/2, √2/2) —
            // the old code placed the badge on the empty side of the arc
            const arcId = solver.addArc(0, 0, 10, 0, 0, -10);
            const otherId = solver.addArc(100, 100, 110, 100, 100, 110);
            solver.addConstraint({
                kind: ConstraintKind.EqualArcRadius,
                refs: [
                    { entityId: arcId, pointIndex: 0 },
                    { entityId: arcId, pointIndex: 1 },
                    { entityId: otherId, pointIndex: 0 },
                    { entityId: otherId, pointIndex: 1 },
                ],
            });
            const annotations = new SketchAnnotationManager(view, solver, new Map());

            annotations.setHighlightedEntities([arcId]);

            // px = 1 in the mock view: the badge floats 18 world units past the radius-10 arc
            const badge = badges.find((b) => b.x < 0);
            expect(badge).toBeDefined();
            const found = badge as { text: string; x: number; y: number };
            const radius = 10 + 18;
            expect(found.x).toBeCloseTo(-radius * Math.SQRT1_2, 5);
            expect(found.y).toBeCloseTo(radius * Math.SQRT1_2, 5);
            annotations.dispose();
            solver.dispose();
        } finally {
            restoreFactory();
        }
    });
});

describe("clusterBadges", () => {
    const at = (u: number, v: number) => ({ u, v, draggable: false });

    test("folds the placements sharing an anchor into one group", () => {
        const groups = clusterBadges([at(0, 0), at(0, 0), at(0, 0)], 28);
        expect(groups.length).toBe(1);
        expect(groups[0].length).toBe(3);
    });

    test("keeps placements further apart than the merge distance in their own groups", () => {
        const groups = clusterBadges([at(0, 0), at(40, 0)], 28);
        expect(groups.length).toBe(2);
        expect(groups.every((group) => group.length === 1)).toBe(true);
    });

    test("measures against each group's first placement, not the previous one", () => {
        // 24 is inside the distance of 0, so it joins; 46 is inside the distance of 24 but
        // far outside the group's anchor at 0, so it starts a group of its own — a chain
        // must not drag the stack away from where its first badge belongs
        const groups = clusterBadges([at(0, 0), at(24, 0), at(46, 0)], 28);
        expect(groups.length).toBe(2);
        expect(groups[0].length).toBe(2);
        expect(groups[1][0].u).toBe(46);
    });

    test("leaves a datum out — its position is the one the user placed", () => {
        const groups = clusterBadges([{ u: 0, v: 0, draggable: true }, at(0, 0)], 28);
        expect(groups.length).toBe(1);
        expect(groups[0].length).toBe(1);
    });
});
