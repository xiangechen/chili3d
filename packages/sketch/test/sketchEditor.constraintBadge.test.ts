// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICameraController, Plane, Result, VisualConfig, XYZ } from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { SketchEditor } from "../src/editor/sketchEditor";
import type { SketchEventHandler } from "../src/editor/sketchEventHandler";
import { ConstraintKind } from "../src/sketchModel";
import { SketchNode } from "../src/sketchNode";
import "./setup";

interface MockBadge {
    text: string;
    position: { x: number; y: number; z: number };
    options: any;
    element: HTMLElement;
    disposed: boolean;
}

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

    const badges: MockBadge[] = [];
    (view as any).htmlText = rs.fn(
        (text: string, position: { x: number; y: number; z: number }, options: any) => {
            const element = document.createElement("div");
            if (options?.className) element.className = options.className;
            const badge: MockBadge = { text, position, options, element, disposed: false };
            badges.push(badge);
            options?.onCreated?.(element);
            return {
                dispose: rs.fn(() => {
                    badge.disposed = true;
                }),
            };
        },
    );
    const displayed: { id: number; colors: number[] }[] = [];
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn((datas: any[]) => {
        displayed.push({ id: nextMeshId, colors: datas.map((d) => d.color) });
        return nextMeshId++;
    });
    const removeMesh = rs.fn();
    (doc.visual.context as any).removeMesh = removeMesh;

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
    return { app, doc, view, badges, displayed, removeMesh, restoreFactory };
}

function pointerEvent(x: number, y: number): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0, shiftKey: false } as PointerEvent;
}

// mock view maps world (x, y, 0) -> screen (400 + x, 300 - y): a line (0,0)-(100,0)
// spans screen x 400..500 at y 300; clicking (450, 300) selects the line
function setupHorizontalLine() {
    const ctx = setup();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    editor.solver.addLine(0, 0, 100, 0);
    editor.solver.addConstraint({
        kind: ConstraintKind.Horizontal,
        refs: [
            { entityId: 1, pointIndex: 0 },
            { entityId: 1, pointIndex: 1 },
        ],
    });
    editor.solve(true);
    const handler = ctx.doc.visual.eventHandler as SketchEventHandler;
    handler.pointerDown(ctx.view, pointerEvent(450, 300));
    handler.pointerUp(ctx.view, pointerEvent(450, 300));
    return { ...ctx, editor, handler };
}

function lastBadge(badges: MockBadge[], text: string): MockBadge {
    const badge = badges.findLast((b) => b.text === text);
    expect(badge).toBeDefined();
    return badge as MockBadge;
}

describe("SketchEditor constraint badge interaction", () => {
    test("only datum badges are double-click editable", () => {
        const { doc, view, badges, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 100,
            });
            editor.solve(true);
            // select the line so its H symbol badge shows
            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));

            expect(lastBadge(badges, "H").options.onDoubleClick).toBeUndefined();
            expect(lastBadge(badges, "100.00").options.onDoubleClick).toBeDefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("hovering a badge highlights its referenced entities, leaving clears it", () => {
        const { badges, displayed, removeMesh, editor, restoreFactory } = setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            const before = displayed.length;
            badge.options.onMouseEnter();

            expect(displayed.length).toBe(before + 1);
            expect(displayed[before].colors).toEqual([VisualConfig.highlightEdgeColor]);

            badge.options.onMouseLeave();
            expect(removeMesh).toHaveBeenCalledWith(displayed[before].id);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("hovering a badge clears the previous entity hover highlight", () => {
        const { doc, view, badges, displayed, removeMesh, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            // line 1 at screen y 300 with a dimension, line 2 at screen y 250 with an H badge
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 50, 100, 50);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 100,
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 2, pointIndex: 0 },
                    { entityId: 2, pointIndex: 1 },
                ],
            });
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const live = () => badges.filter((b) => !b.disposed).map((b) => b.text);

            // hover line 2: its hover mesh and H badge show
            handler.pointerMove(view, pointerEvent(450, 250));
            const hoverMesh = displayed[displayed.length - 1];
            expect(live()).toContain("H");

            // jump straight onto line 1's dimension badge (badge events skip pointerMove)
            lastBadge(badges, "100.00").options.onMouseEnter();

            // the stale hover on line 2 is gone and its symbol badge hides
            expect(removeMesh).toHaveBeenCalledWith(hoverMesh.id);
            expect(live()).not.toContain("H");
            // exactly one constraint highlight mesh, for line 1 only
            expect(displayed[displayed.length - 1].colors).toEqual([VisualConfig.highlightEdgeColor]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("pointermove landing on a badge keeps the entity hover alive", () => {
        const { doc, view, badges, displayed, removeMesh, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            // hover the line: hover mesh shows and its H badge appears
            const before = displayed.length;
            handler.pointerMove(view, pointerEvent(450, 300));
            expect(displayed.length).toBe(before + 1);
            const liveBadges = () => badges.filter((b) => b.text === "H" && !b.disposed);
            expect(liveBadges().length).toBe(1);

            // a fast jump lands the cursor on the badge: the event bubbles with the
            // badge as target and badge-relative offsets — it must not clear the hover
            const badge = liveBadges()[0];
            handler.pointerMove(view, {
                offsetX: 2,
                offsetY: 2,
                target: badge.element,
            } as unknown as PointerEvent);
            expect(liveBadges().length).toBe(1);
            expect(removeMesh).not.toHaveBeenCalledWith(displayed[before].id);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("clicking blank space clears the constraint selection along with the entity selection", () => {
        const { view, badges, editor, handler, restoreFactory } = setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            badge.options.onClick({ stopPropagation: rs.fn(), shiftKey: false });
            expect(editor.annotations.selectedConstraintIds).toEqual([1]);

            handler.pointerDown(view, pointerEvent(100, 100));
            handler.pointerUp(view, pointerEvent(100, 100));
            expect(editor.annotations.selectedConstraintIds).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("shift-click toggles a badge out of the selection", () => {
        const { badges, editor, restoreFactory } = setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            badge.options.onClick({ stopPropagation: rs.fn(), shiftKey: false });
            badge.options.onClick({ stopPropagation: rs.fn(), shiftKey: true });
            expect(editor.annotations.selectedConstraintIds).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Delete removes the selected constraint", () => {
        const { view, badges, editor, handler, restoreFactory } = setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            badge.options.onClick({ stopPropagation: rs.fn(), shiftKey: false });

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Delete" }));
            expect(editor.solver.toData().constraints).toEqual([]);
            // the entity itself survives
            expect(editor.solver.entities().length).toBe(1);
            expect(editor.annotations.selectedConstraintIds).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Delete removes the hovered constraint when nothing is selected", () => {
        const { view, badges, editor, handler, restoreFactory } = setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            badge.options.onMouseEnter();

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Delete" }));
            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.solver.entities().length).toBe(1);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("deleting the hovered constraint also removes its entity highlight", () => {
        const { view, badges, displayed, removeMesh, editor, handler, restoreFactory } =
            setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            const before = displayed.length;
            badge.options.onMouseEnter();
            expect(displayed.length).toBe(before + 1);

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Delete" }));
            expect(editor.solver.toData().constraints).toEqual([]);
            expect(removeMesh).toHaveBeenCalledWith(displayed[before].id);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Escape clears the constraint selection before the entity selection", () => {
        const { app, view, badges, editor, handler, restoreFactory } = setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            badge.options.onClick({ stopPropagation: rs.fn(), shiftKey: false });

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Escape" }));
            expect(editor.annotations.selectedConstraintIds).toEqual([]);
            expect(SketchEditor.getActive()).toBe(editor);

            // second Escape clears the entity selection, third exits
            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Escape" }));
            expect(SketchEditor.getActive()).toBe(editor);
            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Escape" }));
            expect(SketchEditor.getActive()).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("constraint symbols are hidden while a pick is active and restored on cancel", async () => {
        const { badges, editor, restoreFactory } = setupHorizontalLine();
        try {
            const live = () => badges.filter((b) => !b.disposed).map((b) => b.text);
            expect(live()).toContain("H");

            const pick = editor.pickPoint("prompt.pickSketchPoint");
            expect(live()).not.toContain("H");

            editor.cancelPick();
            await expect(pick).resolves.toBeUndefined();
            expect(live()).toContain("H");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("completing a pick restores the constraint symbols", async () => {
        const { view, badges, editor, handler, restoreFactory } = setupHorizontalLine();
        try {
            const live = () => badges.filter((b) => !b.disposed).map((b) => b.text);
            const pick = editor.pickPoint("prompt.pickSketchPoint");
            expect(live()).not.toContain("H");

            // the line starts at world (0,0) -> screen (400,300)
            handler.pointerDown(view, pointerEvent(400, 300));
            await expect(pick).resolves.toEqual({ entityId: 1, pointIndex: 0 });
            expect(live()).toContain("H");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("the badge is offset from the line so it does not cover it", () => {
        const { badges, editor, restoreFactory } = setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            // segment midpoint is world (50, 0); the mock view scale is 1 world unit per
            // pixel, so the badge is pushed BADGE_OFFSET_PX along the segment normal
            expect(badge.position.x).toBeCloseTo(50);
            expect(badge.position.y).toBeCloseTo(18);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("hover survives while the cursor crosses to the offset badge", () => {
        const { doc, view, badges, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const live = () => badges.filter((b) => !b.disposed).map((b) => b.text);

            handler.pointerMove(view, pointerEvent(450, 300));
            expect(live()).toContain("H");

            // the badge sits at world (50, 18) -> screen (450, 282), past the 8px pick tolerance
            handler.pointerMove(view, pointerEvent(450, 282));
            expect(live()).toContain("H");

            // moving far away releases the hover and hides the badge
            handler.pointerMove(view, pointerEvent(450, 100));
            expect(live()).not.toContain("H");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});

describe("SketchEditor dimension preview", () => {
    test("distance preview follows the pointer during position pick and clears after", async () => {
        const { doc, view, badges, displayed, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const live = () => badges.filter((b) => !b.disposed).map((b) => b.text);

            const pick = editor.pickPosition("prompt.pickDimensionPosition", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined
                        ? undefined
                        : { kind: "distance", p1: [0, 0], p2: [100, 0], position: uv },
                ),
            );

            const meshesBefore = displayed.length;
            handler.pointerMove(view, pointerEvent(450, 250));
            expect(live()).toContain("100.00");
            // the extension/dimension/arrow segments were rendered as one mesh
            expect(displayed.length).toBe(meshesBefore + 1);

            // moving rebuilds the preview instead of stacking badges
            handler.pointerMove(view, pointerEvent(450, 200));
            expect(live().filter((t) => t === "100.00").length).toBe(1);

            editor.annotations.setDimensionPreview(undefined);
            expect(live()).not.toContain("100.00");

            editor.cancelPick();
            await expect(pick).resolves.toBeUndefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("radius preview shows during position pick and disappears on cancel", async () => {
        const { doc, view, badges, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addCircle(0, 0, 30);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const live = () => badges.filter((b) => !b.disposed).map((b) => b.text);

            const pick = editor.pickPosition("prompt.pickDimensionPosition", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined
                        ? undefined
                        : { kind: "radius", center: [0, 0], radius: 30, position: uv },
                ),
            );
            handler.pointerMove(view, pointerEvent(500, 300));
            expect(live()).toContain("R30.00");

            editor.cancelPick();
            await expect(pick).resolves.toBeUndefined();
            editor.annotations.setDimensionPreview(undefined);
            expect(live()).not.toContain("R30.00");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("segment preview connects the first point to the cursor while picking the second", async () => {
        const { doc, view, badges, displayed, removeMesh, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const live = () => badges.filter((b) => !b.disposed).map((b) => b.text);

            const pick = editor.pickPoint("prompt.pickSketchPoint", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined ? undefined : { kind: "segment", p1: [0, 0], p2: uv },
                ),
            );

            const meshesBefore = displayed.length;
            handler.pointerMove(view, pointerEvent(450, 250));
            // a bare connecting line: one mesh, no text badge
            expect(displayed.length).toBe(meshesBefore + 1);
            expect(live()).toEqual([]);

            editor.annotations.setDimensionPreview(undefined);
            expect(removeMesh).toHaveBeenCalledWith(displayed[displayed.length - 1].id);

            editor.cancelPick();
            await expect(pick).resolves.toBeUndefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});
