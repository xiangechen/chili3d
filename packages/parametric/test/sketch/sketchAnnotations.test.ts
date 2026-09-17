// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICameraController, Plane, Result, XYZ } from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
// side effect: registers the constraint commands so their decorator icons resolve
import "../../src/sketch/commands/sketchConstraints";
import { SketchAnnotationManager } from "../../src/sketch/editor/sketchAnnotations";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { SketchSolver } from "../../src/sketch/solver";
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
            expect(htmlTexts).toContain("10.00");
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
