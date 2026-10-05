// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
    DefaultDarkDrivenColor,
    DefaultDarkEdgeColor,
    DefaultLightDrivenColor,
    defaultFontService,
    type ICameraController,
    Plane,
    PubSub,
    Result,
    VisualConfig,
    XYZ,
} from "@chili3d/core";
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
import { laidTexts } from "./laidTexts";
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
            // wire the same listeners threeView.htmlText does, so a test can drive a badge
            // with real events instead of reaching into the options object it was given
            if (options?.interactive) {
                element.addEventListener("pointerdown", (e) => e.stopPropagation());
                element.addEventListener("pointerup", (e) => e.stopPropagation());
                if (options.onClick) element.addEventListener("click", options.onClick);
                if (options.onDoubleClick) element.addEventListener("dblclick", options.onDoubleClick);
                if (options.onMouseEnter) element.addEventListener("mouseenter", options.onMouseEnter);
                if (options.onMouseLeave) element.addEventListener("mouseleave", options.onMouseLeave);
            }
            options?.onCreated?.(element);
            return {
                dispose: rs.fn(() => {
                    badge.disposed = true;
                    element.remove();
                }),
            };
        },
    );
    const displayed: { id: number; colors: number[]; datas: any[]; meshOption?: any }[] = [];
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn((datas: any[], meshOption?: any) => {
        displayed.push({ id: nextMeshId, colors: datas.map((d) => d.color), datas, meshOption });
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

function pointerEvent(x: number, y: number, shiftKey = false): PointerEvent {
    // client and offset agree in these tests — happy-dom rects are zero-origin — and the label
    // drag reads `clientX/Y` for its origin while the plane mapping reads `offsetX/Y`.
    return {
        offsetX: x,
        offsetY: y,
        clientX: x,
        clientY: y,
        button: 0,
        shiftKey,
        preventDefault: () => {},
        stopPropagation: () => {},
    } as unknown as PointerEvent;
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

/** The live stack chip whose face carries `text`. */
function liveChip(badges: MockBadge[], text: string): MockBadge {
    const chip = badges.findLast(
        (b) => b.text === text && !b.disposed && b.element.classList.contains(annotationsStyle.stack),
    );
    expect(chip).toBeDefined();
    return chip as MockBadge;
}

/** The member badges inside a chip — plain elements, not CSS2D labels of their own. */
function stackMembers(chip: MockBadge): HTMLElement[] {
    return [...chip.element.querySelectorAll<HTMLElement>(`.${annotationsStyle.stackMember}`)];
}

/** The member of a chip whose face reads `label` (constraint commands are unregistered here). */
function memberFaced(chip: MockBadge, label: string): HTMLElement {
    const member = stackMembers(chip).find((element) => element.textContent === label);
    expect(member).toBeDefined();
    return member as HTMLElement;
}

/**
 * Runs `body` with `showDialog` captured, so a test can see whether a gesture opened a value
 * editor without a UI package to render one. `PubSub.default.pub` is restored either way.
 */
async function withDialogCapture(body: (dialogs: unknown[][]) => Promise<void> | void): Promise<void> {
    const dialogs: unknown[][] = [];
    const originalPub = PubSub.default.pub as unknown as (key: string, ...args: unknown[]) => void;
    PubSub.default.pub = ((key: string, ...args: unknown[]) => {
        if (key === "showDialog") {
            dialogs.push(args);
            return;
        }
        originalPub.call(PubSub.default, key, ...args);
    }) as typeof PubSub.default.pub;
    try {
        await body(dialogs);
    } finally {
        PubSub.default.pub = originalPub as typeof PubSub.default.pub;
    }
}

describe("SketchEditor constraint badge interaction", () => {
    test("only datum labels are editable — a symbol badge has no value to open", () => {
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
            const dimension = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 100,
            });
            editor.dimensionAnchors.set(dimension, { kind: "offset", offset: 30 });
            editor.solve(true);
            // select the line so its H symbol badge shows
            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));

            // a symbol badge is a picture with nothing behind it
            expect(lastBadge(badges, "H").options.onDoubleClick).toBeUndefined();
            // and the datum has no badge at all — its value is drawn as mesh glyphs, and the
            // pointer reaches it through the plane hit-test
            expect(badges.findLast((b) => b.text === "100.00")).toBeUndefined();
            expect(editor.annotations.labelAt(50, 41.5)).toBe(dimension);
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

            // Hovering repaints, and repainting rebuilds the badges — so the element the
            // cursor is on is not the one that was entered. The leave comes from the one
            // standing now, as the browser's own does.
            lastBadge(badges, "H").element.dispatchEvent(new MouseEvent("mouseleave"));
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
            // line 1 at screen y 300 with a dimension (whose label sits just above it), line 2 at
            // screen y 200 with an H badge — clear of that label, which takes what it covers
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 100, 100, 100);
            const dimension = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 100,
            });
            editor.dimensionAnchors.set(dimension, { kind: "offset", offset: 30 });
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
            handler.pointerMove(view, pointerEvent(450, 200));
            const hoverMesh = displayed[displayed.length - 1];
            expect(live()).toContain("H");

            // jump straight onto line 1's dimension label
            handler.pointerMove(view, pointerEvent(450, 250));

            // the stale hover on line 2 is gone and its symbol badge hides
            expect(removeMesh).toHaveBeenCalled();
            expect(live()).not.toContain("H");
            // the highlighted entities are line 1's — line 2's are gone with its hover (the
            // label's own tone rides along in the same repaint, which is why this is a
            // containment and not the whole list)
            expect(displayed[displayed.length - 1].colors).toContain(VisualConfig.highlightEdgeColor);
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

/** One length dimension on a line, with nothing else in the sketch. */
function setupDimension() {
    const ctx = setup();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    editor.solver.addLine(0, 0, 100, 0);
    const dimension = editor.solver.addConstraint({
        kind: ConstraintKind.P2PDistance,
        refs: [
            { entityId: 1, pointIndex: 0 },
            { entityId: 1, pointIndex: 1 },
        ],
        datum: 100,
    });
    editor.dimensionAnchors.set(dimension, { kind: "offset", offset: 30 });
    editor.solve(true);
    return { ...ctx, node, editor, dimension };
}

// SELECTED_COLOR / HOVERED_COLOR in sketchAnnotations.ts are VisualConfig's
const SELECTED_COLOR = VisualConfig.selectedEdgeColor;
const HOVERED_COLOR = VisualConfig.highlightFaceColor;

describe("SketchEditor dimension label dragging", () => {
    // happy-dom rects are zero-origin, so client coordinates map straight to
    // view offsets; the mock view maps offset (x, y) -> uv (x - 400, 300 - y)
    // `button` is which button changed, `buttons` is the mask still held — a real drag
    // keeps its button down between the press and the release, and the drag tells the two
    // apart to notice a release it never saw
    // A label has no element to press any more: it is mesh glyphs, and the viewport hit-tests it
    // in the sketch plane (`SketchAnnotationManager.labelAt`). So the press goes through the
    // handler, exactly as a real one does.
    const press = (editor: SketchEditor, x: number, y: number) =>
        (editor.document.visual.eventHandler as SketchEventHandler).pointerDown(
            editor.view,
            pointerEvent(x, y),
        );
    const move = (x: number, y: number) =>
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, buttons: 1 }));
    const release = (x: number, y: number) =>
        window.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y, buttons: 0 }));

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
        const ctx = setupDistanceDimension();
        const { node, editor, restoreFactory } = ctx;
        try {
            press(editor, 450, 250);
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
            // moving is not selecting: a gesture that travelled moves the label only
            expect(editor.annotations.selectedConstraintIds).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    /**
     * A label is mesh glyphs: a press on it has no element to survive, and the repaint the press
     * triggers cannot take the thing it pressed away. What has to survive instead is the box the
     * pointer is tested against — it is rebuilt by every refresh, and a stale or missing one would
     * be a label that cannot be pressed twice.
     */
    test("a label stays hit-testable through the repaint a click triggers", () => {
        const ctx = setupDistanceDimension();
        const { editor, displayed, restoreFactory } = ctx;
        try {
            expect(editor.annotations.labelAt(50, 41.5)).toBe(1);
            const meshesBefore = displayed.length;
            press(editor, 450, 250);
            release(450, 250);

            expect(editor.annotations.selectedConstraintIds).toEqual([1]);
            // the tone is the mesh's to draw, so the click did repaint...
            expect(displayed.length).toBeGreaterThan(meshesBefore);
            // ...and the label is still where the pointer found it
            expect(editor.annotations.labelAt(50, 41.5)).toBe(1);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("the grab cursor is handed back when the pointer leaves the label for the geometry", () => {
        const ctx = setupDistanceDimension();
        const { editor, restoreFactory } = ctx;
        try {
            const handler = ctx.doc.visual.eventHandler as SketchEventHandler;
            const dom = (ctx.view as any).dom as HTMLElement;

            // offset (450, 250) -> uv (50, 50): the label's own block
            handler.pointerMove(ctx.view, pointerEvent(450, 250));
            expect(dom.style.cursor).toBe("grab");

            // offset (450, 300) -> uv (50, 0): the line behind it, which is not a label — the
            // entity hover takes the pointer back, and the cursor has to come with it
            handler.pointerMove(ctx.view, pointerEvent(450, 300));
            expect(dom.style.cursor).toBe("");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("clicking a dimension label selects it and leaves it where it is", () => {
        const ctx = setupDistanceDimension();
        const { node, editor, restoreFactory } = ctx;
        try {
            expect(editor.annotations.selectedConstraintIds).toEqual([]);

            press(editor, 450, 250);
            release(450, 250);

            // a click means the dimension: it is what the toolbar, the panel and the
            // keyboard act on — and it did not move, nor commit anything
            expect(editor.annotations.isLabelDragging).toBe(false);
            expect(editor.annotations.selectedConstraintIds).toEqual([1]);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "offset", offset: 30 });
            expect(node.data.anchors).toBeUndefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("hovering the dimension line hovers the dimension", () => {
        const { view, editor, dimension, restoreFactory } = setupDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            expect(editor.annotations.hoveredConstraintId).toBeUndefined();

            // the dimension line runs at v = 30, thirty units above the geometry it
            // measures — uv (50, 30) is on it and nowhere near the line itself
            handler.pointerMove(view, pointerEvent(450, 270));
            expect(editor.annotations.hoveredConstraintId).toBe(dimension);

            // the geometry keeps its own hover: on the line itself the dimension does
            // not take it over (their real conflict — an extension line ends on the
            // geometry, or a leader on a rim — is what "pressing an endpoint drops the
            // dimension selection" covers, the mock's pick tolerance being zero)
            handler.pointerMove(view, pointerEvent(450, 300));
            expect(editor.annotations.hoveredConstraintId).toBeUndefined();

            // and off everything the hover goes
            handler.pointerMove(view, pointerEvent(450, 100));
            expect(editor.annotations.hoveredConstraintId).toBeUndefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("pressing a dimension's drawn graphics selects it — line or extension line", () => {
        const { view, badges, editor, dimension, restoreFactory } = setupDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            press(editor, 450, 250);
            release(450, 250);
            expect(editor.annotations.selectedConstraintIds).toEqual([dimension]);

            // away from it first, so the second press has something to replace
            handler.pointerDown(view, pointerEvent(700, 100));
            expect(editor.annotations.selectedConstraintIds).toEqual([]);

            // The dimension line just under the value, then its extension line: both mean the
            // dimension. The press has to clear the value's own glyph box, which sits on the line
            // (the text is raised half its height) — an inch lower is the line and not the label.
            handler.pointerDown(view, pointerEvent(450, 275));
            expect(editor.annotations.selectedConstraintIds).toEqual([dimension]);
            expect(editor.selectedEntityIds()).toEqual([]);

            handler.pointerDown(view, pointerEvent(700, 100));
            handler.pointerDown(view, pointerEvent(400, 285)); // the extension line at u = 0
            expect(editor.annotations.selectedConstraintIds).toEqual([dimension]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("pressing the geometry drops the dimension selection", () => {
        const { view, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            press(editor, 450, 250);
            release(450, 250);
            expect(editor.annotations.selectedConstraintIds).toEqual([1]);

            // Pressing the line is a press about the line. The dimension is not what was
            // pressed, so it stops being selected — this used to keep it, because only
            // the empty-space path cleared it and this one returns early.
            handler.pointerDown(view, pointerEvent(450, 300));
            expect(editor.annotations.selectedConstraintIds).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    // Also the precedence between the two targets: the extension line ends exactly on
    // that endpoint, so both are under the press and the point has to win.
    test("pressing an endpoint drops the dimension selection too", () => {
        const { view, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            press(editor, 450, 250);
            release(450, 250);
            expect(editor.annotations.selectedConstraintIds).toEqual([1]);

            // the same for the endpoint, which starts a point drag instead of a selection
            handler.pointerDown(view, pointerEvent(400, 300));
            expect(editor.annotations.selectedConstraintIds).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("shift-clicking a label adds it to the selection", () => {
        const ctx = setupDistanceDimension();
        const { node, editor, restoreFactory } = ctx;
        try {
            // a second dimension, priced differently so its badge can be told apart
            const line = editor.solver.addLine(0, 200, 100, 200);
            const second = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
                datum: 50,
            });
            editor.dimensionAnchors.set(second, { kind: "offset", offset: 30 });
            editor.solve(true);

            press(editor, 450, 250);
            release(450, 250);
            // the second label, a shift-press away from the first
            (editor.document.visual.eventHandler as SketchEventHandler).pointerDown(
                editor.view,
                pointerEvent(450, 50, true),
            );
            window.dispatchEvent(new MouseEvent("pointerup", { clientX: 450, clientY: 50, shiftKey: true }));

            expect(editor.annotations.selectedConstraintIds.sort((a, b) => a - b)).toEqual([1, second]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a dragged label keeps one colour, however often the drag redraws it", () => {
        const ctx = setupDistanceDimension();
        const { view, editor, displayed, restoreFactory } = ctx;
        const handler = editor.document.visual.eventHandler as SketchEventHandler;
        try {
            handler.pointerMove(view, pointerEvent(450, 250)); // the label, so the hover is on
            press(editor, 450, 250);
            move(450, 200);
            move(450, 150);

            // The label is mesh glyphs: the drag redraws the whole thing on every move, and
            // nothing about that can leave it painted in anything but its own tone. (The
            // element that used to be rebuilt here had a whole class of stale boundary events
            // around it — a label with no element has none of them.)
            expect(editor.annotations.hoveredConstraintId).toBe(1);
            const last = displayed[displayed.length - 1];
            expect(last.colors).toContain(HOVERED_COLOR);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Escape during a drag restores the anchor it started from", () => {
        const { node, view, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            press(editor, 450, 250);
            move(450, 200);
            expect(editor.dimensionAnchors.get(1)).toEqual({ kind: "offset", offset: 100, along: 50 });

            // the button is still down: the drag is live, and Escape abandons it
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

    test("Delete removes the dimension a click selected", () => {
        const { node, view, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            press(editor, 450, 250);
            release(450, 250);
            expect(editor.annotations.selectedConstraintIds).toEqual([1]);

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Delete" }));
            expect(editor.solver.toData().constraints).toEqual([]);
            // the deletion was committed
            expect(node.data.constraints).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a release the label would have covered still completes the drag", () => {
        const ctx = setupDistanceDimension();
        const { node, editor, restoreFactory } = ctx;
        try {
            press(editor, 450, 250);
            move(450, 200);
            // the label is mesh glyphs with nothing over them: a release anywhere — including
            // where the label now is — reaches the window listener that ends the drag
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

    test("a release the window never saw does not leave the label following the cursor", () => {
        const { badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            press(editor, 450, 250);
            move(450, 200);
            const dragged = editor.dimensionAnchors.get(1);
            expect(editor.annotations.isLabelDragging).toBe(true);

            // The pointer comes back over the window with its button already up — the one
            // report of a release that happened where this window could not hear it. The
            // drag has to end here, or the label keeps following the cursor for good.
            window.dispatchEvent(new MouseEvent("pointermove", { clientX: 600, clientY: 100, buttons: 0 }));

            expect(editor.annotations.isLabelDragging).toBe(false);
            // and it stayed where the drag left it: that last move did not drag it further
            expect(editor.dimensionAnchors.get(1)).toEqual(dragged);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a drag whose release never arrives does not swallow the next click", () => {
        const { view, badges, editor, restoreFactory } = setupDistanceDimension();
        try {
            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            press(editor, 450, 250);
            release(450, 250);
            expect(editor.annotations.selectedConstraintIds).toEqual([1]);

            // drag it, and never release: the pointer went to another window, which is
            // the one way the window's own pointerup never arrives
            press(editor, 450, 250);
            move(450, 200);
            expect(editor.annotations.isLabelDragging).toBe(true);

            // The next press on empty space has to do both: end that drag, because
            // otherwise the viewport stays deaf to hover for good, and clear the
            // selection, because that is what pressing empty space is for.
            handler.pointerDown(view, pointerEvent(700, 100));
            expect(editor.annotations.isLabelDragging).toBe(false);
            expect(editor.annotations.selectedConstraintIds).toEqual([]);
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

            press(editor, 400, 300);
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

describe("SketchEditor dimension reading", () => {
    test("a distance whose datum is negative still reads positive", () => {
        const ctx = setup();
        try {
            const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            // the same two points told in the other order: garlic's reading `second − first` is
            // then −100, and that sign is only which point is to the right of the other
            editor.solver.addConstraint({
                kind: ConstraintKind.HorizontalDistance,
                refs: [
                    { entityId: 1, pointIndex: 1 },
                    { entityId: 1, pointIndex: 0 },
                ],
                datum: -100,
            });
            editor.solve(true);

            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(-100);
            const laid = laidTexts(() => editor.solve(true));
            // the label is mesh glyphs, so what it *reads* is what the font was asked to lay out
            expect(laid).toContain("100.00");
            expect(laid.filter((text) => text.startsWith("-"))).toEqual([]);

            // the arrowheads and the glyphs are faces, and a shaded face draws a different colour
            // from the line beside it — the tone *is* the information (`MeshOption.unlit`)
            const faces = ctx.displayed.filter((mesh) => mesh.datas.some((data: any) => "index" in data));
            expect(faces.length).toBeGreaterThan(0);
            for (const face of faces) {
                expect(face.meshOption).toEqual({ onTop: true, unlit: true });
            }
            editor.exit();
        } finally {
            ctx.restoreFactory();
        }
    });

    test("double-clicking a label opens its dialog, on the value the dimension reads", async () => {
        const ctx = setup();
        try {
            const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            // the far point picked first, so garlic's `second − first` comes out negative — the
            // datum is a side marker, and what the dialog opens on is the reading (`datumReading`)
            const dimension = editor.solver.addConstraint({
                kind: ConstraintKind.HorizontalDistance,
                refs: [
                    { entityId: 1, pointIndex: 1 },
                    { entityId: 1, pointIndex: 0 },
                ],
                datum: -100,
            });
            editor.dimensionAnchors.set(dimension, { kind: "offset", offset: 30 });
            editor.solve(true);
            const handler = ctx.doc.visual.eventHandler as SketchEventHandler;

            await withDialogCapture(async (dialogs) => {
                // a double-click is two clicks on the label, which is where the value editor has
                // to come from — there is no badge to take the browser's own `dblclick`
                handler.pointerDown(ctx.view, pointerEvent(450, 250));
                window.dispatchEvent(new MouseEvent("pointerup", { clientX: 450, clientY: 250 }));
                handler.pointerDown(ctx.view, pointerEvent(450, 250));
                window.dispatchEvent(new MouseEvent("pointerup", { clientX: 450, clientY: 250 }));

                expect(dialogs.length).toBe(1);
                const input = (dialogs[0][1] as HTMLElement).querySelector("input");
                expect(input?.value).toBe("100.00");
            });
            editor.exit();
        } finally {
            ctx.restoreFactory();
        }
    });

    test("two clicks on a label with a press elsewhere between them are not a double-click", async () => {
        const ctx = setup();
        try {
            const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            const dimension = editor.solver.addConstraint({
                kind: ConstraintKind.HorizontalDistance,
                refs: [
                    { entityId: 1, pointIndex: 1 },
                    { entityId: 1, pointIndex: 0 },
                ],
                datum: -100,
            });
            editor.dimensionAnchors.set(dimension, { kind: "offset", offset: 30 });
            editor.solve(true);
            const handler = ctx.doc.visual.eventHandler as SketchEventHandler;

            await withDialogCapture(async (dialogs) => {
                const clickLabel = () => {
                    handler.pointerDown(ctx.view, pointerEvent(450, 250));
                    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 450, clientY: 250 }));
                };
                clickLabel();
                expect(editor.annotations.selectedConstraintIds).toEqual([dimension]);

                // offset (450, 300) -> uv (50, 0): the line the dimension measures. Pressing it is
                // a press on the canvas, so the click above is spent and the one below is the
                // first of a new pair rather than the second of the old one.
                handler.pointerDown(ctx.view, pointerEvent(450, 300));
                window.dispatchEvent(new MouseEvent("pointerup", { clientX: 450, clientY: 300 }));
                clickLabel();

                expect(dialogs.length).toBe(0);
                expect(editor.annotations.selectedConstraintIds).toEqual([dimension]);
            });
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

    /**
     * A preview's text is mesh glyphs, and the test font draws one triangle per character, so
     * the mesh size is the text's length — which is how a sign shows up here at all: "-30.00" is
     * one glyph longer than "30.00".
     */
    test("an axis preview reads positive whichever way its two points run", () => {
        const { doc, displayed, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);

            const faceSize = (p1: [number, number], p2: [number, number]) => {
                editor.annotations.setDimensionPreview({
                    kind: "axisDistance",
                    p1,
                    p2,
                    axis: "h",
                    position: [50, 30],
                });
                const face = displayed[displayed.length - 1].datas.find((d) => "index" in d);
                return face?.position.length;
            };

            const forwards = faceSize([0, 0], [100, 0]);
            const backwards = faceSize([100, 0], [0, 0]);
            // the same span either way: "100.00" both times, never "-100.00"
            expect(backwards).toBe(forwards);
            editor.annotations.setDimensionPreview(undefined);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a point-line preview reads positive on either side of its line", () => {
        const { doc, displayed, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);

            const faceSize = (p: [number, number]) => {
                editor.annotations.setDimensionPreview({
                    kind: "pointLine",
                    p,
                    l1: [0, 0],
                    l2: [100, 0],
                    position: [50, 30],
                });
                const face = displayed[displayed.length - 1].datas.find((d) => "index" in d);
                return face?.position.length;
            };

            // 30 above the line and 30 below it: the same reading, and the drawing says which
            expect(faceSize([50, 30])).toBe(faceSize([50, -30]));
            editor.annotations.setDimensionPreview(undefined);
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
            // Highlighting the entity brings the horizontal up too. It anchors on the very
            // same point as the vertical, so the two fold into one chip: the chip reads red
            // for the vertical it stands for, while the horizontal's own member stays normal.
            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));
            const chip = liveChip(badges, "H");
            expect(chip.element.classList.contains(annotationsStyle.conflicting)).toBe(true);
            expect(memberFaced(chip, "H").classList.contains(annotationsStyle.conflicting)).toBe(false);
            expect(memberFaced(chip, "V").classList.contains(annotationsStyle.conflicting)).toBe(true);

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

            // both horizontals of the pair anchor on the same point, so without any hover
            // they fold into one chip — which reads amber for the pair it stands for
            const hChip = liveChip(ctx.badges, "H");
            expect(ctx.badges.filter((b) => b.text === "H" && !b.disposed).length).toBe(1);
            expect(hChip.element.classList.contains(annotationsStyle.redundant)).toBe(true);
            const count = hChip.element.querySelector(`.${annotationsStyle.stackCount}`);
            expect(count).not.toBeNull();
            expect(count!.textContent).toBe("2");

            // both datum meshes draw amber, so no normal-blue annotation mesh remains
            const colors = lastAnnotationColors(ctx.displayed);
            expect(colors).toContain(REDUNDANT_COLOR);
            expect(colors).not.toContain(DIMENSION_COLOR);
            expect(colors).not.toContain(CONFLICT_COLOR);

            // opening the chip shows the pair it stood for, each member amber on its own
            hChip.options.onMouseEnter();
            const opened = liveChip(ctx.badges, "H");
            expect(opened.element.classList.contains(annotationsStyle.expanded)).toBe(true);
            const members = stackMembers(opened);
            expect(members.length).toBe(2);
            expect(members.every((m) => m.classList.contains(annotationsStyle.redundant))).toBe(true);
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
            // the horizontal and the vertical share one chip now: the vertical's conflict
            // shows on the chip, while the horizontal inside it stays normal
            const chip = liveChip(badges, "H");
            expect(memberFaced(chip, "V").classList.contains(annotationsStyle.conflicting)).toBe(true);
            expect(chip.element.classList.contains(annotationsStyle.conflicting)).toBe(true);
            expect(memberFaced(chip, "H").classList.contains(annotationsStyle.conflicting)).toBe(false);
            // the surviving dimension is still conflicting, so its mesh stays red
            const stillRed = lastAnnotationColors(displayed);
            expect(stillRed).toContain(CONFLICT_COLOR);
            expect(stillRed).not.toContain(DIMENSION_COLOR);

            // deleting the vertical clears the last conflict, and leaves the horizontal
            // alone on its anchor — so it goes back to a plain badge, drawn normal again
            editor.deleteConstraints([ids.verticalId]);
            expect(editor.diagnostics.conflicting).toEqual([]);
            const loneH = liveBadge(badges, "H");
            expect(loneH.element.classList.contains(annotationsStyle.stack)).toBe(false);
            expect(loneH.element.classList.contains(annotationsStyle.conflicting)).toBe(false);
            const colors = lastAnnotationColors(displayed);
            expect(colors).toContain(DIMENSION_COLOR);
            expect(colors).not.toContain(CONFLICT_COLOR);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});

describe("SketchEditor driven dimension display", () => {
    // the driven tone is the theme's to say, so it is read from `VisualConfig` rather than
    // copied — the two themes put a reference grey in different places (see `drivenColor`)
    const DIMENSION_COLOR = 0x4a9eff;

    /** A length dimension the user has switched to a reference. */
    function setupDriven() {
        const ctx = setup();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        editor.solver.addLine(0, 0, 100, 0);
        const refs = [
            { entityId: 1, pointIndex: 0 },
            { entityId: 1, pointIndex: 1 },
        ];
        const dimension = editor.solver.addConstraint({
            kind: ConstraintKind.P2PDistance,
            refs,
            datum: 100,
        });
        editor.solve(true);
        editor.setConstraintsDriven([dimension], true);
        return { ...ctx, node, editor, dimension, refs };
    }

    const liveBadge = (badges: MockBadge[], text: string): MockBadge => {
        const badge = badges.findLast((b) => b.text === text && !b.disposed);
        expect(badge).toBeDefined();
        return badge as MockBadge;
    };

    test("reads in parentheses, grey, and keeps its mesh glyphs on the value", () => {
        const { displayed, editor, restoreFactory } = setupDriven();
        try {
            // the parentheses are the text's own signal — they survive a screenshot and a
            // colour vision deficiency, which the grey does not
            expect(laidTexts(() => editor.solve(true))).toContain("(100.00)");

            // the value is drawn in the driven grey, and nothing is left in the normal blue
            const entry = displayed.findLast((d) => d.colors.some((c) => c === VisualConfig.drivenColor));
            expect(entry).toBeDefined();
            expect(entry?.colors).not.toContain(DIMENSION_COLOR);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("the grey is the theme's, and a theme change repaints it", () => {
        const { displayed, editor, restoreFactory } = setupDriven();
        const before = {
            edge: VisualConfig.defaultEdgeColor,
            driven: VisualConfig.drivenColor,
        };
        try {
            // the light and dark backdrops are #888888 and #242424, which straddle a mid grey:
            // the same reference value cannot be quiet on the one and visible on the other
            expect(DefaultLightDrivenColor).not.toBe(DefaultDarkDrivenColor);
            expect(before.driven).toBe(
                before.edge === DefaultDarkEdgeColor ? DefaultDarkDrivenColor : DefaultLightDrivenColor,
            );

            // the other theme's window, at the minute it is painted into: a theme change has to
            // reach the mesh, since the tone lives in it and not in the DOM
            const other = before.edge === DefaultDarkEdgeColor ? "light" : "dark";
            const moved = displayed.length;
            VisualConfig.applyTheme(other);
            expect(displayed.length).toBeGreaterThan(moved);
            const entry = displayed.findLast((d) => d.colors.some((c) => c === VisualConfig.drivenColor));
            expect(entry).toBeDefined();
            expect(entry?.colors).not.toContain(before.driven);
            editor.exit();
        } finally {
            VisualConfig.applyTheme(before.edge === DefaultDarkEdgeColor ? "dark" : "light");
            restoreFactory();
        }
    });

    test("a driving dimension on the same edges still reads normally", () => {
        const { editor, restoreFactory } = setupDriven();
        try {
            const second = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 100,
            });
            editor.solve(true);
            expect(editor.solver.toData().constraints.find((c) => c.id === second)?.driven).toBeUndefined();

            // one label each, and only the reference is parenthesised
            const laid = laidTexts(() => editor.solve(true));
            expect(laid).toContain("(100.00)");
            expect(laid).toContain("100.00");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("editing it is refused, with the reason, and no dialog opens", () => {
        const { editor, dimension, restoreFactory } = setupDriven();
        try {
            const tips: string[] = [];
            const dialogs: unknown[] = [];
            const onTip = (key: string) => tips.push(key);
            const onDialog = () => dialogs.push(undefined);
            PubSub.default.sub("statusBarTip", onTip);
            PubSub.default.sub("showDialog", onDialog);
            try {
                editor.editDatum(dimension);

                // the value belongs to the geometry: there is nothing here to type into
                expect(tips).toEqual(["sketch.drivenNotEditable"]);
                expect(dialogs).toEqual([]);
            } finally {
                PubSub.default.remove("statusBarTip", onTip);
                PubSub.default.remove("showDialog", onDialog);
            }
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});

describe("SketchEditor dimension highlight and selection display", () => {
    /** The colours of the last annotation mesh drawn. */
    const lastColors = (displayed: { colors: number[] }[]): number[] => {
        const entry = displayed.at(-1);
        expect(entry).toBeDefined();
        return entry?.colors ?? [];
    };

    test("the selected dimension draws its whole mesh in the selection green", () => {
        const { editor, dimension, displayed, restoreFactory } = setupDimension();
        try {
            expect(lastColors(displayed)).not.toContain(SELECTED_COLOR);

            editor.annotations.selectConstraints([dimension]);
            expect(lastColors(displayed)).toContain(SELECTED_COLOR);
            // the whole mesh, not just a part of it: lines and glyphs travel together
            expect(lastColors(displayed)).not.toContain(0x4a9eff);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("hovering the label paints it in the hover green", () => {
        const { badges, editor, displayed, restoreFactory } = setupDimension();
        try {
            expect(displayed.some((d) => d.colors.includes(HOVERED_COLOR))).toBe(false);

            const handler = editor.document.visual.eventHandler as SketchEventHandler;
            handler.pointerMove(editor.view, pointerEvent(450, 250));
            // the label's own mesh, not the geometry highlight the same hover raises —
            // that one is drawn in the edge green, and this is the yellower face green
            expect(displayed.some((d) => d.colors.includes(HOVERED_COLOR))).toBe(true);

            // and moving off it (the label is mesh, so the leave is just the pointer moving)
            handler.pointerMove(editor.view, pointerEvent(700, 100));
            expect(editor.annotations.hoveredConstraintId).toBeUndefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a hovered dimension draws in the hover green", () => {
        const { editor, dimension, displayed, restoreFactory } = setupDimension();
        try {
            // Read through the constraint list's hover, which repaints the annotations and
            // nothing else. Hovering the *badge* reaches the same `toneOf` branch, but it
            // also highlights the referenced geometry — in the very same green — so the
            // label's own mesh is not the last thing drawn and cannot be told apart here.
            editor.annotations.highlightConstraint(dimension);
            expect(lastColors(displayed)).toContain(HOVERED_COLOR);

            editor.annotations.highlightConstraint(undefined);
            expect(lastColors(displayed)).not.toContain(HOVERED_COLOR);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("the loudest state wins: a fault outranks a selection, a selection outranks driven", () => {
        const { editor, dimension, displayed, restoreFactory } = setupDimension();
        try {
            // a second dimension over the same edges restates the first — garlic reports
            // the pair redundant, and that amber is not to be hidden by a click
            const second = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 100,
            });
            editor.solve(true);
            editor.annotations.selectConstraints([second]);
            expect(lastColors(displayed)).toContain(0xffd93d);

            // ...while a reference reads as selected while it is, and the parentheses
            // in its text are what keeps saying it is one
            editor.annotations.selectConstraints([]);
            editor.solver.setDriven(dimension, true);
            editor.solve(true);
            expect(lastColors(displayed)).toContain(VisualConfig.drivenColor);
            editor.annotations.selectConstraints([dimension]);
            expect(lastColors(displayed)).toContain(SELECTED_COLOR);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a selected datum badge stays invisible, so its value is not drawn twice", () => {
        // The badge is the label's interaction layer and nothing else — the value on the
        // canvas is 23px of mesh glyphs. A state that lets the badge paint its own 12px
        // text over them draws two texts a size apart, so every state has to be
        // transparent for a ghost. This reads the stylesheet's own cascade: the two are
        // equally specific, so which one applies is decided by source order alone.
        const css = readFileSync(
            path.resolve(process.cwd(), "packages/parametric/src/sketch/editor/sketchAnnotations.module.css"),
            "utf8",
        );
        const sheet = document.createElement("style");
        sheet.textContent = css;
        document.head.appendChild(sheet);
        try {
            const datum = document.createElement("div");
            datum.className = "badge ghost selected";
            document.body.append(datum);
            const symbol = document.createElement("div");
            symbol.className = "badge selected";
            document.body.append(symbol);
            try {
                expect(getComputedStyle(datum).color).toBe("transparent");
                // the same classes on a symbol badge do read as selected — being a ghost
                // is the whole of the exception
                expect(getComputedStyle(symbol).color).not.toBe("transparent");
            } finally {
                datum.remove();
                symbol.remove();
            }
        } finally {
            sheet.remove();
        }
    });
});

describe("constraint badge stacks", () => {
    /**
     * A line whose Horizontal constraint shares its anchor with the Parallel constraint's
     * badge for that line — the two resolve to the very same point. The parallel's other
     * entity sits far enough away that its own badge stays a badge of its own.
     */
    function setupStackedLine(originX = 0) {
        const ctx = setup();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        editor.solver.addLine(originX, 0, originX + 100, 0);
        editor.solver.addLine(originX, 100, originX + 100, 100);
        const horizontalId = editor.solver.addConstraint({
            kind: ConstraintKind.Horizontal,
            refs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
            ],
        });
        const parallelId = editor.solver.addConstraint({
            kind: ConstraintKind.Parallel,
            refs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
                { entityId: 2, pointIndex: 0 },
                { entityId: 2, pointIndex: 1 },
            ],
        });
        editor.solve(true);
        const handler = ctx.doc.visual.eventHandler as SketchEventHandler;
        // hover line 1 rather than selecting it: a hover is what the chip's own enter
        // clears, so this is the path where the badges get rebuilt under the cursor
        // (the mock view maps world x to screen x + 400, so the line's middle is at +50)
        handler.pointerMove(ctx.view, pointerEvent(originX + 450, 300));
        return { ...ctx, editor, handler, horizontalId, parallelId };
    }

    /**
     * One parallel constraint whose two badges land within the stack distance of each other
     * — a single constraint that would fold into a chip of its own two faces.
     */
    function setupSelfOverlappingParallel() {
        const ctx = setup();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        editor.solver.addLine(0, 0, 100, 0);
        editor.solver.addLine(0, 20, 100, 20);
        editor.solver.addConstraint({
            kind: ConstraintKind.Parallel,
            refs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
                { entityId: 2, pointIndex: 0 },
                { entityId: 2, pointIndex: 1 },
            ],
        });
        editor.solve(true);
        const handler = ctx.doc.visual.eventHandler as SketchEventHandler;
        handler.pointerMove(ctx.view, pointerEvent(450, 300));
        return { ...ctx, editor, handler };
    }

    /**
     * Two stacks that share a leader: the parallel is added first, so its two badges lead
     * one stack each. Nothing else ties the two stacks together.
     */
    function setupTwoStacksSharingALeader() {
        const ctx = setup();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        editor.solver.addLine(0, 0, 100, 0);
        editor.solver.addLine(0, 60, 100, 60);
        const lineRefs = (entityId: number) => [
            { entityId, pointIndex: 0 },
            { entityId, pointIndex: 1 },
        ];
        const parallelId = editor.solver.addConstraint({
            kind: ConstraintKind.Parallel,
            refs: [...lineRefs(1), ...lineRefs(2)],
        });
        const horizontalIds = [
            editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs: lineRefs(1) }),
            editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs: lineRefs(2) }),
        ];
        editor.solve(true);
        const handler = ctx.doc.visual.eventHandler as SketchEventHandler;
        // hover line 1: enough to raise the near stack, whose own enter then highlights both
        handler.pointerMove(ctx.view, pointerEvent(450, 300));
        return { ...ctx, editor, handler, parallelId, horizontalIds };
    }

    test("constraints sharing an anchor fold into one chip instead of drawing over each other", () => {
        const { badges, editor, restoreFactory } = setupStackedLine();
        try {
            const chip = liveChip(badges, "H");
            expect(chip.element.classList.contains(annotationsStyle.expanded)).toBe(false);
            // it sits well inside the viewport, so it opens to the right
            expect(chip.element.classList.contains(annotationsStyle.flip)).toBe(false);

            const count = chip.element.querySelector(`.${annotationsStyle.stackCount}`);
            expect(count).not.toBeNull();
            expect(count!.textContent).toBe("2");

            // the members are DOM children of the chip, not labels placed on their own
            const members = stackMembers(chip);
            expect(members.length).toBe(2);
            expect(members.some((member) => member.textContent === "H")).toBe(true);
            expect(members.some((member) => member.textContent === "∥")).toBe(true);
            // so the parallel keeps exactly one label of its own, the far one on line 2
            expect(badges.filter((b) => b.text === "∥" && !b.disposed).length).toBe(1);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a lone constraint still draws a plain badge, with no chip and no count", () => {
        const { badges, editor, restoreFactory } = setupHorizontalLine();
        try {
            const badge = lastBadge(badges, "H");
            expect(badge.element.classList.contains(annotationsStyle.stack)).toBe(false);
            expect(badge.element.querySelector(`.${annotationsStyle.stackCount}`)).toBeNull();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a chip keeps its element through the refresh its own hover triggers", () => {
        const { badges, editor, restoreFactory } = setupStackedLine();
        try {
            const chip = liveChip(badges, "H");
            chip.element.dispatchEvent(new MouseEvent("mouseenter"));

            // the entity hover was the only thing keeping these badges up, and entering the chip
            // clears it — the chip the refresh finds is the same one, element and all, so the
            // cursor is still on the chip it opened (`drawBadge`)
            const opened = liveChip(badges, "H");
            expect(opened.element).toBe(chip.element);
            expect(opened.element.classList.contains(annotationsStyle.expanded)).toBe(true);
            expect(stackMembers(opened).length).toBe(2);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("leaving the chip closes it again", () => {
        const { badges, editor, restoreFactory } = setupStackedLine();
        try {
            liveChip(badges, "H").element.dispatchEvent(new MouseEvent("mouseenter"));
            const opened = liveChip(badges, "H");
            expect(opened.element.classList.contains(annotationsStyle.expanded)).toBe(true);

            opened.element.dispatchEvent(new MouseEvent("mouseleave"));
            const closed = liveChip(badges, "H");
            expect(closed.element.classList.contains(annotationsStyle.expanded)).toBe(false);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("clicking a member selects that one constraint, not the whole chip", () => {
        const { badges, editor, restoreFactory, parallelId } = setupStackedLine();
        try {
            const chip = liveChip(badges, "H");
            memberFaced(chip, "∥").dispatchEvent(new MouseEvent("click", { bubbles: true }));

            // the chip's own click selects every member, so a member click that reached it
            // would select the horizontal too
            expect(editor.annotations.selectedConstraintIds).toEqual([parallelId]);
            // selecting repaints the mesh, and that rebuilds the badges with it — so the
            // chip to look at is the one standing now, not the one that was clicked
            expect(liveChip(badges, "H").element.classList.contains(annotationsStyle.selected)).toBe(true);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("moving from a member back onto the chip keeps the constraint highlighted", () => {
        const { badges, editor, restoreFactory, parallelId } = setupStackedLine();
        try {
            liveChip(badges, "H").element.dispatchEvent(new MouseEvent("mouseenter"));
            const chip = liveChip(badges, "H");
            const member = memberFaced(chip, "∥");

            member.dispatchEvent(new MouseEvent("mouseenter"));
            expect(editor.annotations.hoveredConstraintId).toBe(parallelId);

            // Hovering repaints, and repainting rebuilds the chip — so the element under
            // the cursor is a fresh one, and the boundary events come from that. These
            // are re-queried for the same reason a browser would fire them from the
            // element that is actually there.
            const live = liveChip(badges, "H");
            memberFaced(live, "∥").dispatchEvent(
                new MouseEvent("mouseleave", { relatedTarget: live.element }),
            );
            expect(editor.annotations.hoveredConstraintId).toBe(parallelId);

            // and leaving the stack itself does let the hover go
            liveChip(badges, "H").element.dispatchEvent(new MouseEvent("mouseleave"));
            expect(editor.annotations.hoveredConstraintId).toBeUndefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a chip that would run off the right edge opens leftwards instead", () => {
        // the mock view is 800 wide and puts world x on screen x + 400, so a line out at
        // 700..800 anchors its badges past the right edge
        const { badges, editor, restoreFactory } = setupStackedLine(700);
        try {
            const chip = liveChip(badges, "H");
            expect(chip.element.classList.contains(annotationsStyle.flip)).toBe(true);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("hovering the panel row of a folded constraint opens its chip", () => {
        const { badges, editor, restoreFactory, parallelId } = setupStackedLine();
        try {
            editor.highlightConstraint(parallelId);
            const chip = liveChip(badges, "H");
            expect(chip.element.classList.contains(annotationsStyle.expanded)).toBe(true);
            // the row the pointer is on reads as hovered, so it can be told from its sibling
            expect(memberFaced(chip, "∥").classList.contains(annotationsStyle.hovered)).toBe(true);
            expect(memberFaced(chip, "H").classList.contains(annotationsStyle.hovered)).toBe(false);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a constraint that badges two nearby entities is one member, not two", () => {
        const { badges, editor, restoreFactory } = setupSelfOverlappingParallel();
        try {
            // both of its badges are up, so the cluster is real — it just holds one constraint
            const parallel = badges.filter((b) => b.text === "∥" && !b.disposed);
            expect(parallel.length).toBe(1);
            expect(parallel[0].element.classList.contains(annotationsStyle.stack)).toBe(false);
            expect(parallel[0].element.querySelector(`.${annotationsStyle.stackCount}`)).toBeNull();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("hovering a stack does not raise another that the same constraint leads", () => {
        const { badges, editor, restoreFactory } = setupTwoStacksSharingALeader();
        try {
            const chip = liveChip(badges, "∥");
            const { y } = chip.position;
            chip.element.dispatchEvent(new MouseEvent("mouseenter"));

            // entering the chip cleared the entity hover, so the far stack — same rows, and
            // led by the very same constraint — has nothing left to show. It must not be
            // dragged up by the key of the chip the cursor is on.
            const chips = badges.filter(
                (b) => !b.disposed && b.element.classList.contains(annotationsStyle.stack),
            );
            expect(chips.length).toBe(1);
            expect(chips[0].position.y).toBe(y);
            expect(chips[0].element.classList.contains(annotationsStyle.expanded)).toBe(true);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});
