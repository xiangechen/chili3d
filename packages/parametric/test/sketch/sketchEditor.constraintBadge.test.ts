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
import annotationsStyle from "../../src/sketch/editor/sketchAnnotations.module.css";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
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
            // attach like the real CSS2DRenderer so event propagation reaches window
            document.body.appendChild(element);
            const badge: MockBadge = { text, position, options, element, disposed: false };
            badges.push(badge);
            options?.onCreated?.(element);
            return {
                dispose: rs.fn(() => {
                    badge.disposed = true;
                    element.remove();
                }),
            };
        },
    );
    const displayed: { id: number; colors: number[]; datas: any[] }[] = [];
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn((datas: any[]) => {
        displayed.push({ id: nextMeshId, colors: datas.map((d) => d.color), datas });
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

describe("SketchEditor dimension label dragging", () => {
    // happy-dom rects are zero-origin, so client coordinates map straight to
    // view offsets; the mock view maps offset (x, y) -> uv (x - 400, 300 - y)
    const press = (badge: MockBadge, x: number, y: number) =>
        badge.element.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y, button: 0 }));
    const move = (x: number, y: number) =>
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
    const release = (x: number, y: number) =>
        window.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y }));

    function setupDistanceDimension() {
        const ctx = setup();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        editor.solver.addLine(0, 0, 100, 0);
        editor.solver.addConstraint({
            kind: ConstraintKind.P2PDistance,
            refs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
            ],
            datum: 100,
        });
        editor.dimensionAnchors.set(1, { kind: "offset", offset: 30 });
        editor.solve(true);
        (ctx.view as any).dom = document.createElement("div");
        return { ...ctx, node, editor };
    }

    test("dragging a distance label updates its anchor and commits on release", () => {
        const { node, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const badge = lastBadge(badges, "100.00");
            press(badge, 450, 250);
            expect(editor.annotations.isLabelDragging).toBe(false);

            // offset (450, 200) -> uv (50, 100): 100 above the segment, halfway along it
            move(450, 200);
            expect(editor.annotations.isLabelDragging).toBe(true);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "offset", offset: 100, along: 50 });

            release(450, 200);
            expect(editor.annotations.isLabelDragging).toBe(false);
            expect(node.data.anchors).toEqual([
                { id: 1, anchor: { kind: "offset", offset: 100, along: 50 } },
            ]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("clicking a dimension label picks it up, a viewport click drops it at the new position", () => {
        const { node, view, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            const badge = lastBadge(badges, "100.00");
            press(badge, 450, 250);
            release(450, 250);
            // picked up: the label now follows the cursor, anchor not yet touched
            expect(editor.annotations.isLabelDragging).toBe(true);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "offset", offset: 30 });

            // offset (450, 200) -> uv (50, 100): 100 above the segment, halfway along it
            move(450, 200);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "offset", offset: 100, along: 50 });

            handler.pointerDown(view, pointerEvent(450, 200));
            expect(editor.annotations.isLabelDragging).toBe(false);
            expect(node.data.anchors).toEqual([
                { id: 1, anchor: { kind: "offset", offset: 100, along: 50 } },
            ]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("clicking the label itself also drops it", () => {
        const { node, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            press(lastBadge(badges, "100.00"), 450, 250);
            release(450, 250);
            move(450, 200);
            // the refresh rebuilt the badge under the cursor; pressing it drops the label
            press(lastBadge(badges, "100.00"), 450, 200);
            expect(editor.annotations.isLabelDragging).toBe(false);
            expect(node.data.anchors).toEqual([
                { id: 1, anchor: { kind: "offset", offset: 100, along: 50 } },
            ]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Escape cancels the placement and restores the previous anchor", () => {
        const { node, view, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            press(lastBadge(badges, "100.00"), 450, 250);
            release(450, 250);
            move(450, 200);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "offset", offset: 100, along: 50 });

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Escape" }));
            expect(editor.annotations.isLabelDragging).toBe(false);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "offset", offset: 30 });
            // cancelled: nothing was committed
            expect(node.data.anchors).toBeUndefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Delete while a label follows the cursor deletes the dimension and ends the placement", () => {
        const { node, view, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            press(lastBadge(badges, "100.00"), 450, 250);
            release(450, 250);
            expect(editor.annotations.isLabelDragging).toBe(true);

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Delete" }));
            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.annotations.isLabelDragging).toBe(false);
            // the deletion was committed
            expect(node.data.constraints).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("release landing on the badge still completes the drag (the badge swallows pointerup)", () => {
        const { node, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            press(lastBadge(badges, "100.00"), 450, 250);
            move(450, 200);
            // the refresh rebuilt the badge under the cursor; threeView's interactive
            // badges stopPropagation pointerdown/up, and since the label follows the
            // cursor the release usually lands on it
            const badge = lastBadge(badges, "100.00");
            badge.element.addEventListener("pointerup", (e) => e.stopPropagation());
            badge.element.dispatchEvent(
                new MouseEvent("pointerup", { clientX: 450, clientY: 200, bubbles: true }),
            );
            expect(editor.annotations.isLabelDragging).toBe(false);
            expect(node.data.anchors).toEqual([
                { id: 1, anchor: { kind: "offset", offset: 100, along: 50 } },
            ]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("pick-up released on the badge, then clicking the label again drops it", () => {
        const { node, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const badge = lastBadge(badges, "100.00");
            badge.element.addEventListener("pointerup", (e) => e.stopPropagation());
            press(badge, 450, 250);
            // the swallowed release must still switch to the follow-the-cursor mode
            badge.element.dispatchEvent(
                new MouseEvent("pointerup", { clientX: 450, clientY: 250, bubbles: true }),
            );
            expect(editor.annotations.isLabelDragging).toBe(true);

            move(450, 200);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "offset", offset: 100, along: 50 });

            // the refresh rebuilt the badge under the cursor; pressing it drops the label
            press(lastBadge(badges, "100.00"), 450, 200);
            expect(editor.annotations.isLabelDragging).toBe(false);
            expect(node.data.anchors).toEqual([
                { id: 1, anchor: { kind: "offset", offset: 100, along: 50 } },
            ]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("dragging a radius label re-anchors it as a vector from the center", () => {
        const ctx = setup();
        try {
            const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addCircle(20, 10, 30);
            editor.solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [{ entityId: 1, pointIndex: 0 }],
                datum: 30,
            });
            editor.solve(true);
            (ctx.view as any).dom = document.createElement("div");

            const badge = lastBadge(ctx.badges, "R30.00");
            press(badge, 400, 300);
            // offset (520, 300) -> uv (120, 0): vector (100, -10) from the center (20, 10)
            move(520, 300);
            release(520, 300);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "vector", dx: 100, dy: -10 });
            editor.exit();
        } finally {
            ctx.restoreFactory();
        }
    });
});

describe("SketchEditor dimension preview", () => {
    test("distance preview follows the pointer during position pick and clears after", async () => {
        const { doc, view, badges, displayed, removeMesh, restoreFactory } = setup();
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
            // the preview text draws as mesh glyphs, not as a badge
            expect(live()).not.toContain("100.00");
            expect(displayed.length).toBe(meshesBefore + 1);
            // face channel = 2 arrowheads (6 corners) + the preview text "100.00"
            // (6 glyphs × 1 triangle of the test font)
            const face = displayed[displayed.length - 1].datas.find((d) => "index" in d);
            expect(face?.position.length).toBe(24 * 3);

            // moving rebuilds the preview mesh instead of stacking overlays
            handler.pointerMove(view, pointerEvent(450, 200));
            expect(displayed.length).toBe(meshesBefore + 2);
            expect(removeMesh).toHaveBeenCalledWith(displayed[meshesBefore].id);

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
        const { doc, view, badges, displayed, restoreFactory } = setup();
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
            expect(live()).not.toContain("R30.00");
            // face channel = 1 arrowhead (3 corners) + the preview text "R30.00"
            // (6 glyphs × 1 triangle of the test font)
            const face = displayed[displayed.length - 1].datas.find((d) => "index" in d);
            expect(face?.position.length).toBe(21 * 3);

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

describe("SketchEditor conflicting constraint display", () => {
    // CONFLICT_COLOR / REDUNDANT_COLOR / DIMENSION_COLOR in sketchAnnotations.ts are module-private
    const CONFLICT_COLOR = 0xff6b6b;
    const REDUNDANT_COLOR = 0xffd93d;
    const DIMENSION_COLOR = 0x4a9eff;

    // a line that is told to be both horizontal and vertical, with two contradictory
    // length dimensions — garlic flags the constraints that contradict the established
    // (satisfied) horizontal: the vertical, and the two dimensions against each other
    function setupConflicts() {
        const ctx = setup();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        editor.solver.addLine(0, 0, 100, 0);
        const refs = [
            { entityId: 1, pointIndex: 0 },
            { entityId: 1, pointIndex: 1 },
        ];
        const horizontalId = editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
        const verticalId = editor.solver.addConstraint({ kind: ConstraintKind.Vertical, refs });
        const distanceId = editor.solver.addConstraint({
            kind: ConstraintKind.P2PDistance,
            refs,
            datum: 100,
        });
        const conflictId = editor.solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 50 });
        editor.solve(true);
        return { ...ctx, node, editor, horizontalId, verticalId, distanceId, conflictId };
    }

    const liveBadge = (badges: MockBadge[], text: string): MockBadge => {
        const badge = badges.findLast((b) => b.text === text && !b.disposed);
        expect(badge).toBeDefined();
        return badge as MockBadge;
    };

    // the annotation meshes are the ones carrying a dimension color — entity hover and
    // selection highlights use VisualConfig colors instead
    const lastAnnotationColors = (displayed: { colors: number[] }[]): number[] => {
        const entry = displayed.findLast((d) =>
            d.colors.some((c) => c === CONFLICT_COLOR || c === REDUNDANT_COLOR || c === DIMENSION_COLOR),
        );
        expect(entry).toBeDefined();
        return entry!.colors;
    };

    test("conflicting constraints read red: symbol badges, datum badges and dimension meshes", () => {
        const { doc, view, badges, displayed, editor, restoreFactory, ...ids } = setupConflicts();
        try {
            expect([...editor.diagnostics.conflicting].sort((a, b) => a - b)).toEqual(
                [ids.verticalId, ids.distanceId, ids.conflictId].sort((a, b) => a - b),
            );

            // a conflicting symbol badge shows without any hover or selection —
            // the satisfied horizontal stays hidden until its entity is highlighted
            expect(liveBadge(badges, "V").element.classList.contains(annotationsStyle.conflicting)).toBe(
                true,
            );
            expect(badges.findLast((b) => b.text === "H" && !b.disposed)).toBeUndefined();
            expect(liveBadge(badges, "100.00").element.classList.contains(annotationsStyle.conflicting)).toBe(
                true,
            );
            expect(liveBadge(badges, "50.00").element.classList.contains(annotationsStyle.conflicting)).toBe(
                true,
            );

            // highlighting the entity shows the horizontal too — still not red
            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));
            expect(liveBadge(badges, "H").element.classList.contains(annotationsStyle.conflicting)).toBe(
                false,
            );

            // both dimensions are conflicting, so no normal-blue annotation mesh remains
            const colors = lastAnnotationColors(displayed);
            expect(colors).toContain(CONFLICT_COLOR);
            expect(colors).not.toContain(DIMENSION_COLOR);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("redundant constraints read amber: the whole duplicating pair is marked", () => {
        const ctx = setup();
        try {
            const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            const refs = [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
            ];
            const originalH = editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
            const redundantH = editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
            const originalD = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs,
                datum: 100,
            });
            const redundantD = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs,
                datum: 100,
            });
            editor.solve(true);

            expect(editor.diagnostics.conflicting).toEqual([]);
            expect(editor.diagnostics.redundant).toEqual([originalH, redundantH, originalD, redundantD]);

            // both horizontals of the pair show an amber badge without any hover
            const hBadges = ctx.badges.filter((b) => b.text === "H" && !b.disposed);
            expect(hBadges.length).toBe(2);
            expect(hBadges.every((b) => b.element.classList.contains(annotationsStyle.redundant))).toBe(true);

            // both datum badges of the pair read amber too
            const datumBadges = ctx.badges.filter((b) => b.text === "100.00" && !b.disposed);
            expect(datumBadges.length).toBe(2);
            expect(datumBadges.every((b) => b.element.classList.contains(annotationsStyle.redundant))).toBe(
                true,
            );

            // both datum meshes draw amber, so no normal-blue annotation mesh remains
            const colors = lastAnnotationColors(ctx.displayed);
            expect(colors).toContain(REDUNDANT_COLOR);
            expect(colors).not.toContain(DIMENSION_COLOR);
            expect(colors).not.toContain(CONFLICT_COLOR);
            editor.exit();
        } finally {
            ctx.restoreFactory();
        }
    });

    test("resolving a conflict re-colors only the constraints it involved", () => {
        const { doc, view, badges, displayed, editor, restoreFactory, ...ids } = setupConflicts();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));

            // deleting the "50.00" dimension leaves the vertical/dimension conflict
            editor.deleteConstraints([ids.conflictId]);
            expect([...editor.diagnostics.conflicting].sort((a, b) => a - b)).toEqual(
                [ids.verticalId, ids.distanceId].sort((a, b) => a - b),
            );
            expect(badges.findLast((b) => b.text === "50.00" && !b.disposed)).toBeUndefined();
            expect(liveBadge(badges, "V").element.classList.contains(annotationsStyle.conflicting)).toBe(
                true,
            );
            expect(liveBadge(badges, "100.00").element.classList.contains(annotationsStyle.conflicting)).toBe(
                true,
            );
            expect(liveBadge(badges, "H").element.classList.contains(annotationsStyle.conflicting)).toBe(
                false,
            );
            // the surviving dimension is still conflicting, so its mesh stays red
            const stillRed = lastAnnotationColors(displayed);
            expect(stillRed).toContain(CONFLICT_COLOR);
            expect(stillRed).not.toContain(DIMENSION_COLOR);

            // deleting the vertical clears the last conflict: everything draws normal again
            editor.deleteConstraints([ids.verticalId]);
            expect(editor.diagnostics.conflicting).toEqual([]);
            expect(liveBadge(badges, "H").element.classList.contains(annotationsStyle.conflicting)).toBe(
                false,
            );
            expect(liveBadge(badges, "100.00").element.classList.contains(annotationsStyle.conflicting)).toBe(
                false,
            );
            const colors = lastAnnotationColors(displayed);
            expect(colors).toContain(DIMENSION_COLOR);
            expect(colors).not.toContain(CONFLICT_COLOR);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});
