// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICameraController, Plane, Result, VisualConfig, XY, XYZ } from "@chili3d/core";
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
    // `createMockView`'s worldToScreen maps y to `y + 300` while its rayAt maps it to
    // `300 - y`, so it does not wrap its own rayAt. The real view is self-consistent;
    // box selection compares the two, so this override restores that consistency for
    // the tests here (the shared mock is left alone — other suites depend on it).
    const update = rs.fn(() => {});
    const view = createMockView({
        document: doc,
        cameraController: camera as unknown as ICameraController,
        worldToScreen: (point) => new XY({ x: point.x + 400, y: 300 - point.y }),
        update,
    });
    (app as any).activeView = view;

    const displayed: { id: number; colors: number[] }[] = [];
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn((datas: any[]) => {
        displayed.push({ id: nextMeshId, colors: datas.map((d) => d.color) });
        return nextMeshId++;
    });
    const removed: number[] = [];
    (doc.visual.context as any).removeMesh = rs.fn((id: number) => {
        removed.push(id);
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
    return { doc, view, update, displayed, removed, restoreFactory };
}

function pointerEvent(x: number, y: number, shiftKey = false): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0, shiftKey } as PointerEvent;
}

// mock view maps world (x, y, 0) -> screen (400 + x, 300 - y): the line (0,0)-(100,0)
// spans screen x 400..500 at y 300, and (0,100)-(100,100) spans the same x at y 200.
describe("SketchEditor rubber-band box selection", () => {
    test("a box crossing a line selects it, and only it", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 100, 100, 100);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            // empty space at (390, 310); the box ends past the first line's right end
            handler.pointerDown(view, pointerEvent(390, 310));
            handler.pointerMove(view, pointerEvent(510, 290));
            handler.pointerUp(view, pointerEvent(510, 290));

            expect(handler.selectedEntityIds()).toEqual([1]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a box that only crosses the middle of a line still catches it", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            // neither endpoint is inside the box — only the line passes through it
            handler.pointerDown(view, pointerEvent(440, 320));
            handler.pointerMove(view, pointerEvent(460, 280));
            handler.pointerUp(view, pointerEvent(460, 280));

            expect(handler.selectedEntityIds()).toEqual([1]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("the selection is made on release, not while the box is dragged", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(390, 310));
            handler.pointerMove(view, pointerEvent(510, 290));
            expect(handler.selectedEntityIds()).toEqual([]);

            handler.pointerUp(view, pointerEvent(510, 290));
            expect(handler.selectedEntityIds()).toEqual([1]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a press and release in place stays a blank click", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));
            expect(handler.selectedEntityIds()).toEqual([1]);

            // releasing two pixels away is still a click on empty space, not a box
            handler.pointerDown(view, pointerEvent(390, 310));
            handler.pointerUp(view, pointerEvent(392, 311));
            expect(handler.selectedEntityIds()).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a shift-box adds to the existing selection", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 100, 100, 100);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            // click the lower line, then box the upper one with shift held
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));
            handler.pointerDown(view, pointerEvent(390, 210, true));
            handler.pointerMove(view, pointerEvent(510, 190, true));
            handler.pointerUp(view, pointerEvent(510, 190, true));

            expect(handler.selectedEntityIds().sort()).toEqual([1, 2]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a box answers a multi-entity pick with everything it crossed", async () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 100, 100, 100);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const picking = editor.pickEntities("prompt.pickSketchEntity", "line");
            handler.pointerDown(view, pointerEvent(390, 310));
            handler.pointerMove(view, pointerEvent(510, 190));
            handler.pointerUp(view, pointerEvent(510, 190));

            expect(await picking).toEqual([1, 2]);
            // the pick consumed the box, so no selection lingers for the command to trip over
            expect(handler.selectedEntityIds()).toEqual([1, 2]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a click still answers a multi-entity pick with the one line", async () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const picking = editor.pickEntities("prompt.pickSketchEntity", "line");
            handler.pointerDown(view, pointerEvent(450, 300));
            handler.pointerUp(view, pointerEvent(450, 300));

            expect(await picking).toEqual([1]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a box during the pick hands back only the type the pick asked for", async () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addCircle(50, 50, 30);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const picking = editor.pickEntities("prompt.pickSketchEntity", "line");
            handler.pointerDown(view, pointerEvent(350, 320));
            handler.pointerMove(view, pointerEvent(560, 180));
            handler.pointerUp(view, pointerEvent(560, 180));

            expect(await picking).toEqual([1]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a press on a vertex during the pick starts a box instead of dragging it", async () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const before = JSON.stringify(editor.solver.entity(1));
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const picking = editor.pickEntities("prompt.pickSketchEntity", "line");
            handler.pointerDown(view, pointerEvent(400, 300)); // right on the (0,0) vertex
            handler.pointerMove(view, pointerEvent(470, 330));
            handler.pointerUp(view, pointerEvent(470, 330));

            expect(JSON.stringify(editor.solver.entity(1))).toBe(before);
            // the drag was a box, so it answered the pick with the line it crossed
            expect(await picking).toEqual([1]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("the box outline is drawn into the view while dragging", () => {
        const { doc, view, displayed, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            const before = displayed.length;
            handler.pointerDown(view, pointerEvent(390, 310));
            handler.pointerMove(view, pointerEvent(510, 290));

            // four dashed sides, in the selection colour
            const outline = displayed.slice(before);
            expect(outline.length).toBeGreaterThan(0);
            expect(outline.at(-1)!.colors).toEqual(Array(4).fill(VisualConfig.selectedEdgeColor));

            handler.pointerUp(view, pointerEvent(510, 290));
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a box that catches nothing is repainted away on release", () => {
        const { doc, view, update, displayed, removed, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            // empty space below the line, so the box lands with nothing selected
            handler.pointerDown(view, pointerEvent(390, 500));
            handler.pointerMove(view, pointerEvent(520, 520));
            const boxId = displayed.at(-1)!.id;
            update.mockClear();

            handler.pointerUp(view, pointerEvent(520, 520));

            expect(handler.selectedEntityIds()).toEqual([]);
            expect(removed).toContain(boxId);
            // the outline was dropped between two frames; nothing else in this path
            // repaints, so the release has to ask for one itself
            expect(update).toHaveBeenCalled();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("escape mid-drag repaints the box away", () => {
        const { doc, view, update, displayed, removed, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(390, 500));
            handler.pointerMove(view, pointerEvent(520, 520));
            const boxId = displayed.at(-1)!.id;
            update.mockClear();

            handler.keyDown(view, { key: "Escape" } as KeyboardEvent);

            expect(removed).toContain(boxId);
            expect(update).toHaveBeenCalled();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});
