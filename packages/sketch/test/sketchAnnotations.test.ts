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
import { SketchEditor } from "../src/editor/sketchEditor";
import type { SketchEventHandler } from "../src/editor/sketchEventHandler";
import { ConstraintKind } from "../src/sketchModel";
import { SketchNode } from "../src/sketchNode";
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

    const badgeDisposes: ReturnType<typeof rs.fn>[] = [];
    const htmlTexts: string[] = [];
    (view as any).htmlText = rs.fn((text: string) => {
        htmlTexts.push(text);
        const dispose = rs.fn();
        badgeDisposes.push(dispose);
        return { dispose };
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
    return { doc, view, htmlTexts, badgeDisposes, restoreFactory };
}

function pointerEvent(x: number, y: number, button = 0): PointerEvent {
    return { offsetX: x, offsetY: y, button } as PointerEvent;
}

describe("SketchAnnotations visibility", () => {
    test("constraint badges are hidden until a referenced entity is highlighted", () => {
        const { doc, view, htmlTexts, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solve(true);
            expect(htmlTexts).not.toContain("H");

            // hover the line: the H badge appears
            (doc.visual.eventHandler as SketchEventHandler).pointerMove(view, pointerEvent(405, 300));
            expect(htmlTexts).toContain("H");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("constraint badges disappear when the highlight moves away", () => {
        const { doc, view, htmlTexts, badgeDisposes, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            });
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerMove(view, pointerEvent(405, 300));
            expect(htmlTexts).toContain("H");

            handler.pointerMove(view, pointerEvent(100, 100));
            expect(badgeDisposes.every((d) => d.mock.calls.length > 0)).toBe(true);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("datum dimensions stay visible without any highlight", () => {
        const { doc, htmlTexts, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            editor.solve(true);
            expect(htmlTexts).toContain("10.00");
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("constraint badges stay visible while dragging a referenced point", () => {
        const { doc, view, htmlTexts, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
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
            // mock view: worldToScreen maps (0,0,0) -> (400, 300), grab the line start point
            handler.pointerDown(view, pointerEvent(400, 300));
            expect(htmlTexts).toContain("H");
            handler.pointerUp(view, pointerEvent(400, 300));
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});
