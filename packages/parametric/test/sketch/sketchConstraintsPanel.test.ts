// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys, type ICameraController, Plane, PubSub, Result, XYZ } from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import annotationsStyle from "../../src/sketch/editor/sketchAnnotations.module.css";
import style from "../../src/sketch/editor/sketchConstraintsPanel.module.css";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, type SketchPointRef } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
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
    const badges: { text: string; element: HTMLElement; disposed: boolean }[] = [];
    (view as any).htmlText = rs.fn((text: string, _position: any, options: any) => {
        const element = document.createElement("div");
        const badge = { text, element, disposed: false };
        badges.push(badge);
        options?.onCreated?.(element);
        return {
            dispose: rs.fn(() => {
                badge.disposed = true;
                element.remove();
            }),
        };
    });
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn(() => nextMeshId++);
    (doc.visual.context as any).removeMesh = rs.fn();

    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
            line: () => Result.ok({ isEqual: () => false }),
            circle: () => Result.ok({ isEqual: () => false }),
            arc: () => Result.ok({ isEqual: () => false }),
            wire: () => Result.ok({ isEqual: () => false }),
            combine: () => Result.ok({ isEqual: () => false }),
        },
        writable: true,
        configurable: true,
    });

    const panels: { options: any; content: HTMLElement }[] = [];
    const closedPanels: HTMLElement[] = [];
    const tips: { key: I18nKeys; args: any[] }[] = [];
    const onShow = (options: any) => panels.push({ options, content: options.content });
    const onClosePanel = (content: HTMLElement) => closedPanels.push(content);
    const onTip = (key: I18nKeys, ...args: any[]) => tips.push({ key, args });
    PubSub.default.sub("showFloatPanel", onShow);
    PubSub.default.sub("closeFloatPanel", onClosePanel);
    PubSub.default.sub("statusBarTip", onTip);

    const cleanup = () => {
        SketchEditor.exit();
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
        PubSub.default.remove("showFloatPanel", onShow);
        PubSub.default.remove("closeFloatPanel", onClosePanel);
        PubSub.default.remove("statusBarTip", onTip);
    };
    return { app, doc, view, badges, panels, closedPanels, tips, cleanup };
}

function enterSketch(doc: TestDocument): SketchEditor {
    const node = new SketchNode({ document: doc, plane: Plane.XY });
    return SketchEditor.enter(node);
}

function lineRefs(line: number): SketchPointRef[] {
    return [
        { entityId: line, pointIndex: 0 },
        { entityId: line, pointIndex: 1 },
    ];
}

describe("SketchEditor constraint diagnostics", () => {
    test("the status bar shows the degree-of-freedom count, not 'under-constrained'", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            editor.solver.addLine(0, 0, 100, 0);
            ctx.tips.length = 0;

            editor.solve(true);
            expect(ctx.tips.at(-1)).toEqual({ key: "sketch.dofs{0}", args: [4] });
        } finally {
            ctx.cleanup();
        }
    });

    test("the status bar still says fully constrained at zero dofs and conflicting on a conflict", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            const line = editor.solver.addLine(0, 0, 100, 0);
            const refs = lineRefs(line);
            editor.solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 100 });
            editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
            editor.solver.addConstraint({ kind: ConstraintKind.Fix, refs: [refs[0]], datums: [0, 0] });
            editor.solver.addConstraint({ kind: ConstraintKind.Fix, refs: [refs[1]], datums: [100, 0] });

            ctx.tips.length = 0;
            editor.solve(true);
            expect(ctx.tips.at(-1)?.key).toBe("sketch.fullyConstrained");

            editor.solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 50 });
            editor.solve(true);
            expect(ctx.tips.at(-1)?.key).toBe("sketch.conflicting");
        } finally {
            ctx.cleanup();
        }
    });

    test("the panel lists user constraints and hides the arc's structural incidence", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            const line = editor.solver.addLine(0, 0, 100, 0);
            const horizontalId = editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: lineRefs(line),
            });
            const distanceId = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: lineRefs(line),
                datum: 100,
            });
            editor.solver.addArc(0, 0, 10, 0, 0, 10);
            editor.solve(true);

            editor.toggleConstraintsPanel();
            const panel = ctx.panels.at(-1);
            expect(panel).toBeDefined();
            expect(panel!.options.title).toBe("sketch.constraints");

            const rows = panel!.content.querySelectorAll(`.${style.row}`);
            expect(rows.length).toBe(2);
            const texts = [...rows].map((row) => row.textContent);
            expect(texts.some((text) => text?.includes(`#${horizontalId}`))).toBe(true);
            expect(texts.some((text) => text?.includes(`#${distanceId}`))).toBe(true);
            // the header labels the section and counts the listed constraints
            const header = panel!.content.querySelector(`.${style.header}`);
            expect(header).not.toBeNull();
            expect(header!.textContent).toContain(I18n.translate("sketch.constraints"));
            expect(header!.querySelector(`.${style.count}`)?.textContent).toBe("2");
            // nothing flagged: no state class on the header dot
            expect(header!.classList.contains(style.ok)).toBe(false);
            expect(header!.classList.contains(style.conflicting)).toBe(false);
        } finally {
            ctx.cleanup();
        }
    });

    test("a radius read as a diameter is named and valued as one in the list", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            const asDiameter = editor.solver.addCircle(0, 0, 30);
            const readAsDiameter = editor.solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [{ entityId: asDiameter, pointIndex: 0 }],
                datum: 30,
                display: "diameter",
            });
            editor.dimensionAnchors.set(readAsDiameter, { kind: "vector", dx: 40, dy: 0 });
            const asRadius = editor.solver.addCircle(200, 0, 20);
            const readAsRadius = editor.solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [{ entityId: asRadius, pointIndex: 0 }],
                datum: 20,
            });
            editor.solve(true);

            editor.toggleConstraintsPanel();
            const content = ctx.panels.at(-1)!.content;
            const rowOf = (id: number) =>
                [...content.querySelectorAll(`.${style.row}`)].find((r) =>
                    r.textContent?.includes(`#${id} `),
                );

            // the row reads what the canvas reads, so double-clicking it edits the same number
            // the badge shows — the two constraints underneath are the same kind
            expect(rowOf(readAsDiameter)?.querySelector(`.${style.name}`)?.textContent).toBe(
                `#${readAsDiameter} ${I18n.translate("dimension.diameter")}`,
            );
            expect(rowOf(readAsDiameter)?.querySelector(`.${style.value}`)?.textContent).toBe("Ø60.00");
            expect(rowOf(readAsRadius)?.querySelector(`.${style.name}`)?.textContent).toBe(
                `#${readAsRadius} ${I18n.translate("command.dimension.radius")}`,
            );
            expect(rowOf(readAsRadius)?.querySelector(`.${style.value}`)?.textContent).toBe("R20.00");
        } finally {
            ctx.cleanup();
        }
    });

    test("a row click selects the constraint like a badge click", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            const line = editor.solver.addLine(0, 0, 100, 0);
            const horizontalId = editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: lineRefs(line),
            });
            editor.solve(true);
            editor.toggleConstraintsPanel();
            const content = ctx.panels.at(-1)!.content;

            const row = content.querySelector(`.${style.row}`);
            expect(row).not.toBeNull();
            (row as HTMLElement).click();
            expect(editor.annotations.selectedConstraintIds).toEqual([horizontalId]);
            expect(row!.classList.contains(style.selected)).toBe(true);
        } finally {
            ctx.cleanup();
        }
    });

    test("hovering a row highlights the constraint's badge along with its entities", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            const line = editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs: lineRefs(line) });
            editor.solve(true);
            editor.toggleConstraintsPanel();
            const content = ctx.panels.at(-1)!.content;

            // without a hover the H symbol badge is not shown at all
            const liveBadges = () => ctx.badges.filter((b) => b.text === "H" && !b.disposed);
            expect(liveBadges().length).toBe(0);

            const row = content.querySelector(`.${style.row}`);
            expect(row).not.toBeNull();
            row!.dispatchEvent(new MouseEvent("mouseenter"));

            // the badge appears in its hover look while the pointer is over the row
            const badge = liveBadges().at(-1);
            expect(badge).toBeDefined();
            expect(badge!.element.classList.contains(annotationsStyle.hovered)).toBe(true);

            row!.dispatchEvent(new MouseEvent("mouseleave"));
            expect(liveBadges().length).toBe(0);
        } finally {
            ctx.cleanup();
        }
    });

    test("conflicting and redundant constraints are colored directly in the list", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            const line = editor.solver.addLine(0, 0, 100, 0);
            const horizontalId = editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: lineRefs(line),
            });
            const distanceId = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: lineRefs(line),
                datum: 100,
            });
            const conflictId = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: lineRefs(line),
                datum: 50,
            });
            const redundantId = editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: lineRefs(line),
            });
            editor.solve(true);
            editor.toggleConstraintsPanel();
            const content = ctx.panels.at(-1)!.content;

            const rows = [...content.querySelectorAll(`.${style.row}`)];
            const rowOf = (id: number) => {
                const row = rows.find((r) => r.textContent?.includes(`#${id} `));
                expect(row).toBeDefined();
                return row as HTMLElement;
            };
            // BOTH sides of the datum conflict are marked, and so is the whole
            // duplicating horizontal pair (either one is a valid removal)
            expect(rowOf(distanceId).classList.contains(style.conflicting)).toBe(true);
            expect(rowOf(conflictId).classList.contains(style.conflicting)).toBe(true);
            expect(rowOf(conflictId).title).toBe(I18n.translate("sketch.conflicting"));
            expect(rowOf(redundantId).classList.contains(style.redundant)).toBe(true);
            expect(rowOf(horizontalId).classList.contains(style.conflicting)).toBe(false);
            expect(rowOf(horizontalId).classList.contains(style.redundant)).toBe(true);

            // the issue rides on the row as a chip naming it
            const chipOf = (id: number) => rowOf(id).querySelector(`.${style.chip}`);
            expect(chipOf(distanceId)?.textContent).toBe(I18n.translate("sketch.issue.conflicting"));
            expect(chipOf(conflictId)?.textContent).toBe(I18n.translate("sketch.issue.conflicting"));
            expect(chipOf(redundantId)?.textContent).toBe(I18n.translate("sketch.issue.redundant"));
            expect(chipOf(horizontalId)?.textContent).toBe(I18n.translate("sketch.issue.redundant"));
            // the header dot reflects the worst state
            const header = content.querySelector(`.${style.header}`);
            expect(header!.classList.contains(style.conflicting)).toBe(true);
        } finally {
            ctx.cleanup();
        }
    });

    test("a row's delete button removes the constraint", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            const line = editor.solver.addLine(0, 0, 100, 0);
            const horizontalId = editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: lineRefs(line),
            });
            editor.solve(true);
            editor.toggleConstraintsPanel();
            const content = ctx.panels.at(-1)!.content;

            const button = content.querySelector(`.${style.delete}`);
            expect(button).not.toBeNull();
            (button as HTMLElement).click();

            expect(editor.solver.toData().constraints.some((c) => c.id === horizontalId)).toBe(false);
            // the header count follows the deletion
            expect(content.querySelector(`.${style.count}`)?.textContent).toBe("0");
        } finally {
            ctx.cleanup();
        }
    });

    test("toggling again and exiting the session both close the panel", () => {
        const ctx = setup();
        try {
            const editor = enterSketch(ctx.doc);
            editor.toggleConstraintsPanel();
            const content = ctx.panels.at(-1)!.content;

            editor.toggleConstraintsPanel();
            expect(ctx.closedPanels).toContain(content);

            editor.toggleConstraintsPanel();
            const reopened = ctx.panels.at(-1)!.content;
            expect(ctx.panels.length).toBe(2);

            SketchEditor.exit();
            expect(ctx.closedPanels).toContain(reopened);
        } finally {
            ctx.cleanup();
        }
    });
});
