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
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

/** The tone the handler previews the doomed piece in — pinned, it is the whole cue. */
const TRIM_PREVIEW_COLOR = 0xff6b6b;

function setup() {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: 0, z: 500 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitY,
        cameraType: "orthographic" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;

    const displayed: { colors: number[]; datas: any[] }[] = [];
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn((datas: any[]) => {
        displayed.push({ colors: datas.map((d) => d.color), datas });
        return nextMeshId++;
    });
    (doc.visual.context as any).removeMesh = rs.fn();

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
    return { doc, view, displayed, restoreFactory };
}

function pointerEvent(x: number, y: number): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0, shiftKey: false } as PointerEvent;
}

/**
 * A sketch under a trim pick: the mock view maps world (x, y, 0) to screen
 * (400 + x, 300 − y), so a line (0,0)-(100,0) spans screen x 400..500 at y 300, and a
 * vertical line at x = 50 crosses it at screen (450, 300).
 */
function setupTrimPick() {
    const ctx = setup();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    editor.solver.addLine(0, 0, 100, 0);
    editor.solver.addLine(50, -20, 50, 20);
    editor.solve(true);
    const handler = ctx.doc.visual.eventHandler as SketchEventHandler;
    void editor.pickEntityAt("prompt.pickTrimEntity");
    return { ...ctx, editor, handler };
}

/** The mesh the last hover displayed, or undefined when the hover showed nothing. */
function lastHoverMesh(displayed: { colors: number[]; datas: any[] }[]): any {
    return displayed.at(-1)?.datas[0];
}

describe("SketchEditor trim preview", () => {
    test("hovers the piece past the crossing, not the whole line", () => {
        const { editor, handler, displayed, restoreFactory } = setupTrimPick();
        try {
            handler.pointerMove(editor.view, pointerEvent(475, 300));

            const mesh = lastHoverMesh(displayed);
            expect(mesh.color).toBe(TRIM_PREVIEW_COLOR);
            const position = Array.from(mesh.position as Float32Array);
            expect(position.map(Math.round)).toEqual([50, 0, 0, 100, 0, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("hovers the other piece when the cursor crosses to the other side", () => {
        const { editor, handler, displayed, restoreFactory } = setupTrimPick();
        try {
            handler.pointerMove(editor.view, pointerEvent(475, 300));
            handler.pointerMove(editor.view, pointerEvent(425, 300));

            const position = Array.from(lastHoverMesh(displayed).position as Float32Array);
            expect(position.map(Math.round)).toEqual([0, 0, 0, 50, 0, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("shows nothing on the crossing itself, where the trim would refuse", () => {
        const { editor, handler, displayed, restoreFactory } = setupTrimPick();
        try {
            const before = displayed.length;
            handler.pointerMove(editor.view, pointerEvent(450, 300));
            expect(displayed.length).toBe(before);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("an ordinary hover still highlights the whole entity", () => {
        const { doc, view, displayed, restoreFactory } = setup();
        const node = new SketchNode({ document: doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        try {
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerMove(view, pointerEvent(475, 300));

            const mesh = lastHoverMesh(displayed);
            expect(mesh.color).toBe(VisualConfig.highlightEdgeColor);
            const position = Array.from(mesh.position as Float32Array);
            expect(position.map(Math.round)).toEqual([0, 0, 0, 100, 0, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });
});
