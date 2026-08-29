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
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind } from "../../src/sketch/sketchModel";
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

    const htmlTexts: string[] = [];
    (view as any).htmlText = rs.fn((text: string) => {
        htmlTexts.push(text);
        return { dispose: rs.fn() };
    });
    const displayed: { id: number; colors: number[] }[] = [];
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn((datas: any[]) => {
        displayed.push({ id: nextMeshId, colors: datas.map((d) => d.color) });
        return nextMeshId++;
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
    return { app, doc, view, htmlTexts, displayed, restoreFactory };
}

function pointerEvent(x: number, y: number, shiftKey = false): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0, shiftKey } as PointerEvent;
}

// mock view maps world (x, y, 0) -> screen (400 + x, 300 - y): a line (0,0)-(100,0)
// spans screen x 400..500 at y 300; clicking (450, 300) hits the line 50px from both ends
describe("SketchEditor entity selection", () => {
    test("clicking an entity selects it and shows its constraints without hover", () => {
        const { doc, view, htmlTexts, displayed, restoreFactory } = setup();
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
            expect(htmlTexts).not.toContain("H");

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));

            // a selection highlight mesh with the selected color was displayed
            expect(displayed.some((d) => d.colors.includes(VisualConfig.selectedEdgeColor))).toBe(true);
            // the constraint badge shows even after the mouse is gone (selected state)
            expect(htmlTexts).toContain("H");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("clicking empty space clears the selection and hides its constraints", () => {
        const { doc, view, htmlTexts, restoreFactory } = setup();
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
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));
            expect(htmlTexts).toContain("H");

            htmlTexts.length = 0;
            handler.pointerDown(view, pointerEvent(100, 100));
            handler.pointerUp(view, pointerEvent(100, 100));
            expect(htmlTexts).not.toContain("H");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("shift-click accumulates the selection", () => {
        const { doc, view, displayed, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 100, 100, 100);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            // line 2 spans screen x 400..500 at y 200
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));
            handler.pointerDown(view, pointerEvent(450, 200, true));
            handler.pointerUp(view, pointerEvent(450, 200, true));

            const selectionMesh = displayed.findLast((d) =>
                d.colors.includes(VisualConfig.selectedEdgeColor),
            );
            expect(selectionMesh?.colors.length).toBe(2);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Delete removes the selected entities when nothing is hovered", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));
            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Delete" }));

            expect(editor.solver.entities()).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Escape clears the selection first and exits on the second press", () => {
        const { app, doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Escape" }));
            expect(SketchEditor.getActive()).toBe(editor);

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Escape" }));
            expect(SketchEditor.getActive()).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });
});
