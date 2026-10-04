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
import { mirrorPreview } from "../../src/sketch/mirrorOps";
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

/** The tone the handler previews a mirrored copy in — pinned, it is the whole cue. */
const MIRROR_PREVIEW_COLOR = 0xff6b6b;

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
 * A sketch under a mirror pick. The mock view maps world (x, y, 0) to screen
 * (400 + x, 300 − y), so the vertical mirror line at x = 0 runs down screen x 400, and
 * the source line sits at screen x 450..480 — well clear of it.
 */
function setupMirrorPick({ withSource = true } = {}) {
    const ctx = setup();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    const source = editor.solver.addLine(50, 50, 80, 60);
    const axis = editor.solver.addLine(0, -50, 0, 50);
    editor.solve(true);
    const handler = ctx.doc.visual.eventHandler as SketchEventHandler;
    // the axis is picked FIRST, so with nothing selected there is no source to preview
    const sources = withSource ? [source] : [];
    void editor.pickEntity("prompt.pickMirrorAxis", "line", {
        datum: true,
        previewEntity: (entityId) =>
            entityId === undefined ? undefined : mirrorPreview(editor.solver, sources, entityId, 1e-6),
    });
    return { ...ctx, editor, handler, source, axis };
}

/** The meshes the last hover displayed. */
function lastHoverMeshes(displayed: { datas: any[] }[]): any[] {
    return displayed.at(-1)?.datas ?? [];
}

describe("SketchEditor mirror preview", () => {
    test("hovering the line before any source is chosen still highlights it", () => {
        // nothing to preview yet: the hover must still read as a hover, not as silence
        const { editor, handler, displayed, restoreFactory } = setupMirrorPick({ withSource: false });
        try {
            handler.pointerMove(editor.view, pointerEvent(400, 300));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes).toHaveLength(1);
            expect(meshes[0].color).toBe(VisualConfig.highlightEdgeColor);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("hovering the line shows the mirrored copy in the preview tone", () => {
        const { editor, handler, displayed, restoreFactory } = setupMirrorPick();
        try {
            handler.pointerMove(editor.view, pointerEvent(400, 300));

            const meshes = lastHoverMeshes(displayed);
            // the line stays highlighted under the cursor, and the copy is drawn beside it
            expect(meshes).toHaveLength(2);
            const copy = meshes[1];
            expect(copy.color).toBe(MIRROR_PREVIEW_COLOR);
            const position = Array.from(copy.position as Float32Array);
            // the reflection of (50, 50)-(80, 60) across x = 0
            expect(Array.from(position).map(Math.round)).toEqual([-50, 50, 0, -80, 60, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("hovering the source itself highlights it, but proposes nothing", () => {
        // a line cannot be mirrored about itself, so there is no copy to draw — the hover
        // is still a hover, and the refusal is reported when the pick is actually made
        const { editor, handler, displayed, restoreFactory } = setupMirrorPick();
        try {
            handler.pointerMove(editor.view, pointerEvent(450, 250));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes).toHaveLength(1);
            expect(meshes[0].color).toBe(VisualConfig.highlightEdgeColor);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("the preview is dropped once the cursor leaves the line", () => {
        const { doc, editor, handler, displayed, restoreFactory } = setupMirrorPick();
        try {
            handler.pointerMove(editor.view, pointerEvent(400, 300));
            expect(lastHoverMeshes(displayed)).toHaveLength(2);

            const drawn = displayed.length;
            handler.pointerMove(editor.view, pointerEvent(500, 400));

            // off the line there is nothing to propose: the hover is taken down rather
            // than replaced with an empty one
            expect(displayed.length).toBe(drawn);
            expect(doc.visual.context.removeMesh).toHaveBeenCalled();
        } finally {
            editor.exit();
            restoreFactory();
        }
    });
});
