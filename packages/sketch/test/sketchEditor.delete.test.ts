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
    return { doc, view, restoreFactory };
}

function pointerEvent(x: number, y: number): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0 } as PointerEvent;
}

describe("SketchEditor entity deletion", () => {
    test("Delete removes the hovered entity with its constraints and anchors", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            const constraintId = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            editor.dimensionAnchors.set(constraintId, { kind: "offset", offset: 20 });
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            // hover the line, then delete it (mock view: screen (405, 300) -> uv (5, 0))
            handler.pointerMove(view, pointerEvent(405, 300));
            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Delete" }));

            expect(editor.solver.entities()).toEqual([]);
            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.dimensionAnchors.size).toBe(0);
            expect(node.data.entities).toEqual([]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Delete without a hover highlight does nothing", () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solve(true);

            (doc.visual.eventHandler as SketchEventHandler).keyDown(
                view,
                new KeyboardEvent("keydown", { key: "Delete" }),
            );
            expect(editor.solver.entities().length).toBe(1);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Delete is ignored while a pick is active", async () => {
        const { doc, view, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.solve(true);

            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerMove(view, pointerEvent(405, 300));
            const promise = editor.pickEntity("prompt.pickSketchEntity", "line");
            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Backspace" }));
            expect(editor.solver.entities().length).toBe(1);

            editor.cancelPick();
            await expect(promise).resolves.toBeUndefined();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});
