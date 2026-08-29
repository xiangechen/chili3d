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
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
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
    return { app, doc, view, restoreFactory };
}

function pointerEvent(x: number, y: number): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0 } as PointerEvent;
}

describe("SketchEditor picking", () => {
    test("pickPoint resolves with the hit point on pointerDown", async () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor: SketchEditor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solve(true);

            const promise = editor.pickPoint("prompt.pickSketchPoint");
            expect(editor.isPicking).toBe(true);
            // mock view: worldToScreen maps (0,0,0) -> (400, 300)
            (doc.visual.eventHandler as SketchEventHandler).pointerDown(view, pointerEvent(402, 298));

            await expect(promise).resolves.toEqual({ entityId: 1, pointIndex: 0 });
            expect(editor.isPicking).toBe(false);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Escape cancels an active pick", async () => {
        const { app, doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);

            const promise = editor.pickPoint("prompt.pickSketchPoint");
            (doc.visual.eventHandler as SketchEventHandler).keyDown(view, { key: "Escape" } as KeyboardEvent);

            await expect(promise).resolves.toBeUndefined();
            expect(SketchEditor.getActive()).toBe(editor);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Escape without a pick exits the editing session", () => {
        const { app, doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            SketchEditor.enter(node);
            (doc.visual.eventHandler as SketchEventHandler).keyDown(view, { key: "Escape" } as KeyboardEvent);
            expect(SketchEditor.getActive()).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("pickEntity resolves with the hit line entity", async () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solve(true);

            const promise = editor.pickEntity("prompt.pickSketchEntity", "line");
            // mock view: screen (405, 300) -> ray hits plane at uv (5, 0), on the line
            (doc.visual.eventHandler as SketchEventHandler).pointerDown(view, pointerEvent(405, 300));

            await expect(promise).resolves.toBe(1);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("right-click cancels an active pick", async () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);

            const promise = editor.pickEntity("prompt.pickSketchEntity", "line");
            (doc.visual.eventHandler as SketchEventHandler).pointerDown(view, {
                offsetX: 405,
                offsetY: 300,
                button: 2,
            } as PointerEvent);

            await expect(promise).resolves.toBeUndefined();
            expect(editor.isPicking).toBe(false);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("highlights the hovered line while an entity pick is active", async () => {
        const { doc, view, restoreFactory } = setup();
        const displayMesh = rs.fn(() => 1);
        const removeMesh = rs.fn();
        (doc.visual.context as any).displayMesh = displayMesh;
        (doc.visual.context as any).removeMesh = removeMesh;
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solve(true);

            const promise = editor.pickEntity("prompt.pickSketchEntity", "line");
            const handler = doc.visual.eventHandler as SketchEventHandler;
            // mock view: screen (405, 300) -> uv (5, 0), on the line
            handler.pointerMove(view, pointerEvent(405, 300));
            expect(displayMesh).toHaveBeenCalledTimes(1);

            // same position again: no redundant redraw
            handler.pointerMove(view, pointerEvent(405, 300));
            expect(displayMesh).toHaveBeenCalledTimes(1);

            // move away from the line: hover cleared
            handler.pointerMove(view, pointerEvent(100, 100));
            expect(removeMesh).toHaveBeenCalledTimes(1);

            editor.cancelPick();
            await expect(promise).resolves.toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("clicking a hovered entity clears the hover highlight", async () => {
        const { doc, view, restoreFactory } = setup();
        const displayMesh = rs.fn(() => 1);
        const removeMesh = rs.fn();
        (doc.visual.context as any).displayMesh = displayMesh;
        (doc.visual.context as any).removeMesh = removeMesh;
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solve(true);

            const promise = editor.pickEntity("prompt.pickSketchEntity", "line");
            const handler = doc.visual.eventHandler as SketchEventHandler;
            // hover over the line, then click it without moving the mouse
            handler.pointerMove(view, pointerEvent(405, 300));
            expect(displayMesh).toHaveBeenCalledTimes(1);
            handler.pointerDown(view, pointerEvent(405, 300));

            await expect(promise).resolves.toBe(1);
            expect(removeMesh).toHaveBeenCalledTimes(1);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("highlights entities on hover without an active pick", () => {
        const { doc, view, restoreFactory } = setup();
        const displayMesh = rs.fn(() => 1);
        (doc.visual.context as any).displayMesh = displayMesh;
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solve(true);

            expect(editor.isPicking).toBe(false);
            (doc.visual.eventHandler as SketchEventHandler).pointerMove(view, pointerEvent(405, 300));
            expect(displayMesh).toHaveBeenCalledTimes(1);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});
