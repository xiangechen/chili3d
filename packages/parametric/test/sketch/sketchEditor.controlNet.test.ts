// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The control net the editor draws for the free curves: the dashed segments between the
 * control points a conic, a cubic bezier or a NURBS is drawn *by* rather than through. The
 * markers alone say where the handles are and nothing about what they do, so the net is what
 * makes a handle legible — these tests read the markers and the segments the overlay hands to
 * the view.
 */

import { Plane, VisualConfig } from "@chili3d/core";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { SketchNode } from "../../src/sketch/sketchNode";
import { lastHoverMeshes, setupSketchHover } from "./_helpers/sketchHover";
import "./setup";

/** The overlay the session last handed to the view. */
function overlayOf(setup: { displayed: { colors: number[]; datas: any[] }[] }): any[] {
    return lastHoverMeshes(setup.displayed);
}

/** The dashed segments of an overlay, as their endpoints rounded to 1e-6. */
function dashedSegments(meshes: readonly any[]): number[][] {
    return meshes
        .filter((mesh) => mesh.lineType === "dash")
        .map((mesh) =>
            Array.from(mesh.position as Float32Array).map((value) => Math.round(value * 1e6) / 1e6),
        );
}

/** The markers of an overlay, as their positions. */
function markers(meshes: readonly any[]): number[] {
    return meshes.filter((mesh) => mesh.size !== undefined).map((mesh) => mesh.position[0]);
}

function sessionWith(build: (editor: SketchEditor) => void) {
    const ctx = setupSketchHover();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    build(editor);
    (ctx.doc.visual.eventHandler as SketchEventHandler).refreshEntityPoints();
    return { ...ctx, editor };
}

describe("SketchEditor control net", () => {
    test("a cubic bezier hangs its handles off dashed lines to its ends", () => {
        const { editor, restoreFactory, ...ctx } = sessionWith((editor) =>
            editor.solver.addBezier([0, 0, 1, 2, 3, 2, 4, 0]),
        );
        try {
            const meshes = overlayOf(ctx);
            expect(markers(meshes)).toEqual([0, 1, 3, 4]);
            // the control polygon, in control-point order: each end to its handle and the
            // two handles to each other
            expect(dashedSegments(meshes)).toEqual([
                [0, 0, 0, 1, 2, 0],
                [1, 2, 0, 3, 2, 0],
                [3, 2, 0, 4, 0, 0],
            ]);
        } finally {
            restoreFactory();
            editor.dispose();
        }
    });

    test("a NURBS draws the whole polygon, and a conic its control triangle", () => {
        const nurbs = sessionWith((editor) =>
            editor.solver.addNurbs([0, 0, 1, 2, 3, 2, 4, 0, 5, 3], {
                degree: 3,
                knots: [0, 0, 0, 0, 1, 2, 2, 2, 2],
            }),
        );
        try {
            // five control points, four segments: every one of them is a span's own
            // tangent direction, which is why a spline's whole polygon is drawn
            expect(markers(overlayOf(nurbs))).toEqual([0, 1, 3, 4, 5]);
            expect(dashedSegments(overlayOf(nurbs)).length).toBe(4);
        } finally {
            nurbs.restoreFactory();
            nurbs.editor.dispose();
        }

        const conic = sessionWith((editor) => editor.solver.addConic(0, 0, 1, 3, 4, 0, 0.5));
        try {
            expect(markers(overlayOf(conic))).toEqual([0, 1, 4]);
            expect(dashedSegments(overlayOf(conic))).toEqual([
                [0, 0, 0, 1, 3, 0],
                [1, 3, 0, 4, 0, 0],
            ]);
        } finally {
            conic.restoreFactory();
            conic.editor.dispose();
        }
    });

    test("a line has no net: its points are on the curve already", () => {
        const { editor, restoreFactory, ...ctx } = sessionWith((editor) =>
            editor.solver.addLine(0, 0, 10, 0),
        );
        try {
            const meshes = overlayOf(ctx);
            expect(markers(meshes)).toEqual([0, 10]);
            expect(dashedSegments(meshes)).toEqual([]);
        } finally {
            restoreFactory();
            editor.dispose();
        }
    });

    test("the net takes its entity's own colour, the free one until it is pinned", () => {
        const { editor, restoreFactory, ...ctx } = sessionWith((editor) =>
            editor.solver.addBezier([0, 0, 1, 2, 3, 2, 4, 0]),
        );
        try {
            const net = overlayOf(ctx).filter((mesh: any) => mesh.lineType === "dash");
            expect(net.map((mesh: any) => mesh.color)).toEqual([
                VisualConfig.sketchFreeColor,
                VisualConfig.sketchFreeColor,
                VisualConfig.sketchFreeColor,
            ]);
        } finally {
            restoreFactory();
            editor.dispose();
        }
    });
});
